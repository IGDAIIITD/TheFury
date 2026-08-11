package com.campusforge.backend.feed;

import com.campusforge.backend.common.events.AchievementUnlockedEvent;
import com.campusforge.backend.common.events.CardDiscoveredEvent;
import com.campusforge.backend.common.events.EventLifecycleEvent;
import com.campusforge.backend.common.events.MatchWonEvent;
import com.campusforge.backend.common.events.SpawnEvent;
import com.campusforge.backend.common.events.TradeAcceptedEvent;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.LocalDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * In-memory discovery feed (no DB table). Entries are broadcast over STOMP
 * {@code /topic/feed} for live push and retained in a small ring buffer for the
 * REST fallback / history endpoint. Admin "audit" is the same buffer seen by
 * admins, including event lifecycle and spawn activity.
 */
@Service
public class FeedService {

    public static final int CAPACITY = 50;
    public static final String FEED_TOPIC = "/topic/feed";

    private final SimpMessagingTemplate messaging;
    private final Deque<FeedEntryDto> entries = new ArrayDeque<>();

    public FeedService(SimpMessagingTemplate messaging) {
        this.messaging = messaging;
    }

    public List<FeedEntryDto> history() {
        synchronized (entries) {
            return new ArrayList<>(entries);
        }
    }

    public void publish(FeedType type, String message, String playerName) {
        FeedEntryDto entry = new FeedEntryDto(type.name(), message, playerName, LocalDateTime.now());
        synchronized (entries) {
            entries.addFirst(entry);
            while (entries.size() > CAPACITY) {
                entries.removeLast();
            }
        }
        messaging.convertAndSend(FEED_TOPIC, entry);
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onCardDiscovered(CardDiscoveredEvent event) {
        publish(FeedType.DISCOVERY,
                event.unlocked() ? "discovered " + event.cardForgeName() : "scanned " + event.cardForgeName(),
                event.playerName());
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onMatchWon(MatchWonEvent event) {
        publish(FeedType.DISCOVERY, "won a battle (+" + event.xpAwarded() + " XP)", event.playerName());
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onTradeAccepted(TradeAcceptedEvent event) {
        publish(FeedType.TRADE, "traded unique cards with " + event.receiverName(), event.senderName());
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onAchievementUnlocked(AchievementUnlockedEvent event) {
        for (AchievementUnlockedEvent.AchievementUnlockedItem item : event.achievements()) {
            publish(FeedType.ACHIEVEMENT, "earned the " + item.name() + " achievement", event.playerName());
        }
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onEventLifecycle(EventLifecycleEvent event) {
        publish(FeedType.EVENT,
                (event.active() ? "event started: " : "event updated: ") + event.eventName()
                        + " (\u00d7" + event.bonusMultiplier() + " bonus)",
                null);
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onSpawn(SpawnEvent event) {
        publish(FeedType.SPAWN,
                "spawned " + event.quantity() + " token(s) for " + event.cardForgeName()
                        + (event.building() != null && !event.building().isBlank() ? " at " + event.building() : ""),
                event.adminName());
    }
}
