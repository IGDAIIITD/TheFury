package com.campusforge.backend.achievements;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.analytics.PlayerMetrics;
import com.campusforge.backend.analytics.ProfileStatsDto;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.common.events.AchievementUnlockedEvent;
import com.campusforge.backend.common.events.CardDiscoveredEvent;
import com.campusforge.backend.common.events.MatchWonEvent;
import com.campusforge.backend.common.events.TradeAcceptedEvent;
import com.campusforge.backend.trade.TradeRepository;
import com.campusforge.backend.trade.TradeStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Unlocks stored {@code player_achievements} idempotently (UNIQUE player+code)
 * and emits {@link AchievementUnlockedEvent} for the discovery feed. Listeners
 * run AFTER_COMMIT so the feed only broadcasts achievements whose unlock
 * transaction actually committed.
 */
@Service
public class AchievementService {

    private static final Logger log = LoggerFactory.getLogger(AchievementService.class);

    private final PlayerAchievementRepository achievementRepository;
    private final PlayerRepository playerRepository;
    private final PlayerMetrics playerMetrics;
    private final TradeRepository tradeRepository;
    private final CardRepository cardRepository;
    private final ApplicationEventPublisher publisher;

    public AchievementService(PlayerAchievementRepository achievementRepository,
                              PlayerRepository playerRepository,
                              PlayerMetrics playerMetrics,
                              TradeRepository tradeRepository,
                              CardRepository cardRepository,
                              ApplicationEventPublisher publisher) {
        this.achievementRepository = achievementRepository;
        this.playerRepository = playerRepository;
        this.playerMetrics = playerMetrics;
        this.tradeRepository = tradeRepository;
        this.cardRepository = cardRepository;
        this.publisher = publisher;
    }

    @Transactional
    public List<AchievementUnlockedEvent.AchievementUnlockedItem> unlockFor(UUID playerId) {
        Player player = playerRepository.findById(playerId).orElse(null);
        if (player == null) {
            return List.of();
        }

        PlayerMetrics.BattleStats battleStats = playerMetrics.battleStats(player);
        int level = playerMetrics.levelFor(player);
        long discoveries = playerMetrics.totalDiscoveries(player);
        int completion = playerMetrics.completionPercent(playerMetrics.ownedCardIds(player).size(), cardRepository.count());
        long trades = tradeRepository.countByStatusAndPlayer(TradeStatus.ACCEPTED, playerId);

        List<AchievementUnlockedEvent.AchievementUnlockedItem> unlocked = new ArrayList<>();
        for (AchievementDefinition definition : AchievementCatalog.ALL) {
            long value = switch (definition.metric()) {
                case DISCOVERIES -> discoveries;
                case BATTLES_WON -> battleStats.wins();
                case UNIQUE_TRADES -> trades;
                case LEVEL -> level;
                case COLLECTION_PCT -> completion;
                case UNDEFEATED -> (battleStats.played() >= 1 && battleStats.wins() == battleStats.played()) ? 1 : 0;
            };
            if (value >= definition.threshold()
                    && !achievementRepository.existsByPlayerIdAndCode(playerId, definition.code())) {
                achievementRepository.save(new PlayerAchievement(player, definition.code(), LocalDateTime.now()));
                unlocked.add(new AchievementUnlockedEvent.AchievementUnlockedItem(definition.code(), definition.name()));
            }
        }

        if (!unlocked.isEmpty()) {
            log.info("Unlocked {} achievements for player {}", unlocked.size(), playerId);
            publisher.publishEvent(new AchievementUnlockedEvent(playerId, player.getDisplayName(), unlocked));
        }
        return unlocked;
    }

    @Transactional(readOnly = true)
    public List<ProfileStatsDto.BadgeDto> badgesFor(UUID playerId) {
        return achievementRepository.findByPlayerIdOrderByUnlockedAt(playerId).stream()
                .map(pa -> AchievementCatalog.byCode(pa.getCode())
                        .map(def -> new ProfileStatsDto.BadgeDto(def.code(), def.name(), def.description()))
                        .orElseGet(() -> new ProfileStatsDto.BadgeDto(pa.getCode(), pa.getCode(), "")))
                .toList();
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onCardDiscovered(CardDiscoveredEvent event) {
        unlockFor(event.playerId());
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onMatchWon(MatchWonEvent event) {
        unlockFor(event.playerId());
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onTradeAccepted(TradeAcceptedEvent event) {
        unlockFor(event.senderId());
        unlockFor(event.receiverId());
    }
}
