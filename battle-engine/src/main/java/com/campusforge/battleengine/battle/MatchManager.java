package com.campusforge.battleengine.battle;

import com.campusforge.battleengine.supabase.SupabaseClient;
import com.campusforge.battleengine.supabase.SupabaseClient.DeckProblem;
import com.campusforge.battleengine.supabase.SupabaseClient.SupabaseDeck;
import com.campusforge.battleengine.supabase.SupabaseClient.SupabaseEvent;
import com.campusforge.battleengine.supabase.SupabaseClient.SupabaseMatch;
import com.campusforge.battleengine.battle.dto.MatchDto;
import forge.headless.TestDecks;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * In-memory battle orchestrator for the standalone engine. Every match row lives
 * in Supabase (written by this service via service-role); active Forge sessions
 * live only here. Deck validation and win rewards are delegated to the
 * {@code validate_deck} / {@code record_match_result} RPCs.
 */
@Service
public class MatchManager {

    private static final Logger log = LoggerFactory.getLogger(MatchManager.class);
    private static final long DISCONNECT_GRACE_SECONDS = 60;
    private static final String CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final int CODE_LENGTH = 6;

    private final SupabaseClient supabase;
    private final ForgeDeckConverter deckConverter;
    private final SimpMessagingTemplate messaging;
    private final FeatureFlags featureFlags;
    private final com.campusforge.battleengine.security.SupabaseStompAuthChannelInterceptor stompAuthChannelInterceptor;
    private final SecureRandom random = new SecureRandom();
    private final ScheduledExecutorService scheduler = new ScheduledThreadPoolExecutor(2, r -> {
        Thread t = new Thread(r, "battle-grace");
        t.setDaemon(true);
        return t;
    });

    private final ConcurrentHashMap<UUID, ForgeMatchSession> activeMatches = new ConcurrentHashMap<>();

    public MatchManager(SupabaseClient supabase,
                        ForgeDeckConverter deckConverter,
                        SimpMessagingTemplate messaging,
                        FeatureFlags featureFlags,
                        com.campusforge.battleengine.security.SupabaseStompAuthChannelInterceptor stompAuthChannelInterceptor) {
        this.supabase = supabase;
        this.deckConverter = deckConverter;
        this.messaging = messaging;
        this.featureFlags = featureFlags;
        this.stompAuthChannelInterceptor = stompAuthChannelInterceptor;
    }

    // ------------------------------------------------------------------
    // Match creation
    // ------------------------------------------------------------------

    public MatchDto createMatch(UUID player1Id, UUID deck1Id, UUID player2Id, UUID deck2Id, UUID eventId) {
        if (player2Id == null && !featureFlags.isAiBattlesEnabled()) {
            throw new IllegalArgumentException("AI battles are disabled");
        }
        SupabaseDeck d1 = requireOwnedDeck(deck1Id, player1Id, "Player 1 deck is invalid for match", eventId);
        SupabaseEvent event = resolveEvent(eventId);

        SupabaseDeck d2 = null;
        if (player2Id != null && deck2Id != null) {
            d2 = requireOwnedDeck(deck2Id, player2Id, "Player 2 deck is invalid for event match", eventId);
        }

        SupabaseMatch row = supabase.insertMatch(new SupabaseMatch(
                UUID.randomUUID(), player1Id, player2Id, d1.id(), d2 != null ? d2.id() : null,
                "ACTIVE", null, null, null, event != null ? event.id() : null,
                Instant.now().toString(), null)).orElseThrow(() -> new IllegalStateException("Could not create match"));

        startGame(row.id(), player1Id, deck1Id, player2Id, deck2Id);
        return MatchDto.from(row);
    }

    /** Creates a waiting room for a human-vs-human battle and returns a shareable code. */
    public MatchDto createLobbyMatch(UUID player1Id, UUID deck1Id, UUID eventId) {
        SupabaseDeck d1 = requireOwnedDeck(deck1Id, player1Id, "Deck is invalid for battle", eventId);
        SupabaseEvent event = resolveEvent(eventId);

        SupabaseMatch row = supabase.insertMatch(new SupabaseMatch(
                UUID.randomUUID(), player1Id, null, d1.id(), null,
                "WAITING", null, null, generateUniqueBattleCode(),
                event != null ? event.id() : null, Instant.now().toString(), null))
                .orElseThrow(() -> new IllegalStateException("Could not create lobby"));
        return MatchDto.from(row);
    }

    /** Joins a pending battle by code, making it active and starting the game. */
    public MatchDto joinMatch(String code, UUID player2Id, UUID deck2Id) {
        if (code == null || code.isBlank()) {
            throw new IllegalArgumentException("Battle code is required");
        }
        SupabaseMatch match = supabase.findByBattleCode(code.trim().toUpperCase())
                .orElseThrow(() -> new IllegalArgumentException("Battle code not found"));
        if (match.player1Id().equals(player2Id)) {
            throw new IllegalArgumentException("Cannot join your own battle");
        }
        if (!"WAITING".equals(match.status())) {
            // A retried/double-submitted join by the player who already joined is
            // not an error: hand back the running match.
            if (isAlreadyJoinedBy(match, player2Id)) {
                return MatchDto.from(match);
            }
            throw new IllegalStateException("Battle is no longer open");
        }
        SupabaseDeck d2 = requireOwnedDeck(deck2Id, player2Id, "Deck is invalid for battle", match.eventId());

        // Atomic: only one concurrent joiner flips WAITING -> ACTIVE.
        Optional<SupabaseMatch> claimed = supabase.activateMatch(match.id(), player2Id, deck2Id);
        if (claimed.isEmpty()) {
            SupabaseMatch now = supabase.findMatch(match.id()).orElse(null);
            if (now != null && isAlreadyJoinedBy(now, player2Id)) {
                return MatchDto.from(now); // our own concurrent request won
            }
            throw new IllegalStateException("Battle is no longer open");
        }
        SupabaseMatch active = claimed.get();

        startGame(active.id(), active.player1Id(), active.deck1Id(), player2Id, deck2Id);
        return MatchDto.from(active);
    }

    private static boolean isAlreadyJoinedBy(SupabaseMatch match, UUID player2Id) {
        return "ACTIVE".equals(match.status()) && player2Id.equals(match.player2Id());
    }

    public void startGame(UUID matchId, UUID player1Id, UUID deck1Id, UUID player2Id, UUID deck2Id) {
        SupabaseDeck d1 = supabase.findDeck(deck1Id)
                .orElseThrow(() -> new IllegalArgumentException("Deck 1 not found"));
        forge.deck.Deck forgeDeck1 = deckConverter.toForgeDeck(d1);

        forge.deck.Deck forgeDeck2;
        String player2Name;
        if (player2Id != null && deck2Id != null) {
            SupabaseDeck d2 = supabase.findDeck(deck2Id)
                    .orElseThrow(() -> new IllegalArgumentException("Opponent not found"));
            forgeDeck2 = deckConverter.toForgeDeck(d2);
            player2Name = supabase.displayName(player2Id).orElse(player2Id.toString());
        } else {
            forgeDeck2 = TestDecks.build("Campus Bot", 60);
            player2Name = "Campus Bot";
        }

        String player1Name = supabase.displayName(player1Id).orElse(player1Id.toString());

        ForgeMatchSession session = new ForgeMatchSession(
                matchId,
                forgeDeck1, player1Id, player1Name,
                forgeDeck2, player2Id, player2Name,
                messaging,
                s -> finishGame(matchId, s.getWinnerPlayerId(), s.getWinCondition()));

        ForgeMatchSession previous = activeMatches.put(matchId, session);
        if (previous != null) {
            previous.cancel();
        }
        session.start();
        log.info("Started Forge match session {} ({} vs {})", matchId, player1Name, player2Name);
    }

    public void finishGame(UUID matchId, UUID winnerId, String winCondition) {
        // record_match_result is idempotent and also awards XP + feed server-side.
        log.info("Match {} finished, winner={}, condition={}", matchId, winnerId, winCondition);
        supabase.recordMatchResult(matchId, winnerId, winCondition);
        activeMatches.remove(matchId);
    }

    public void reportDisconnect(UUID matchId, UUID playerId) {
        ForgeMatchSession session = activeMatches.get(matchId);
        if (session == null) {
            return;
        }
        session.markDisconnected(playerId);
        log.warn("Player {} disconnected from match {}, starting {}s grace period",
                playerId, matchId, DISCONNECT_GRACE_SECONDS);
        scheduler.schedule(() -> {
            if (session.isStillDisconnected(playerId) && !session.isFinished() && activeMatches.get(matchId) == session) {
                log.warn("Player {} did not reconnect to match {} within grace period; conceding", playerId, matchId);
                reportConcede(matchId, playerId);
            }
        }, DISCONNECT_GRACE_SECONDS, TimeUnit.SECONDS);
    }

    public void reportConcede(UUID matchId, UUID playerId) {
        SupabaseMatch match = supabase.findMatch(matchId).orElse(null);
        UUID winnerId = null;
        if (match != null) {
            winnerId = match.player1Id().equals(playerId)
                    ? (match.player2Id() != null ? match.player2Id() : null)
                    : match.player1Id();
        }
        // Two-step: award via the RPC (idempotent), then flip status to CONCEDED.
        // record_match_result only awards once, so the row must not be CONCEDED yet.
        supabase.recordMatchResult(matchId, winnerId, "Conceded");
        supabase.markConceded(matchId, winnerId, "Conceded");

        ForgeMatchSession session = activeMatches.remove(matchId);
        if (session != null) {
            String winnerName = winnerId != null ? supabase.displayName(winnerId).orElse(null) : null;
            Map<String, Object> terminal = new java.util.LinkedHashMap<>();
            terminal.put("gameOver", true);
            terminal.put("status", "CONCEDED");
            terminal.put("winnerId", winnerId != null ? winnerId.toString() : null);
            terminal.put("winnerName", winnerName);
            terminal.put("winCondition", "Conceded");
            terminal.put("matchId", matchId.toString());
            messaging.convertAndSend("/topic/match/" + matchId + "/p0", terminal);
            messaging.convertAndSend("/topic/match/" + matchId + "/p1", terminal);
            session.cancel();
        }
    }

    /** Latest serialized game state for a player in a running match, or null if not running. */
    public Map<String, Object> getState(UUID matchId, UUID playerId) {
        ForgeMatchSession session = activeMatches.get(matchId);
        return session != null ? session.getLatestStateForPlayer(playerId) : null;
    }

    public boolean isAiBattlesEnabled() {
        return featureFlags.isAiBattlesEnabled();
    }

    public void handleAction(UUID matchId, UUID playerId, String actionType, Object payload) {
        ForgeMatchSession session = activeMatches.get(matchId);
        if (session == null) {
            return;
        }
        session.onPlayerActivity(playerId);
        if ("CHOICE".equals(actionType) && payload instanceof Map<?, ?> map) {
            Object requestId = map.get("requestId");
            Object indices = map.get("selectedIndices");
            if (requestId instanceof Number number && indices instanceof List<?> list) {
                List<Integer> selected = new ArrayList<>();
                for (Object o : list) {
                    if (o instanceof Number n) {
                        selected.add(n.intValue());
                    }
                }
                boolean accepted = session.submitChoice(playerId, number.longValue(), selected);
                if (!accepted) {
                    log.debug("Rejected choice for match {} player {} (stale request {})",
                            matchId, playerId, number.longValue());
                }
            }
        }
    }

    /** Maps a WebSocket disconnect back to the matches/players that session was watching. */
    @EventListener
    public void onSessionDisconnect(SessionDisconnectEvent event) {
        for (com.campusforge.battleengine.security.SupabaseStompAuthChannelInterceptor.Subscription subscription
                : stompAuthChannelInterceptor.subscriptionsFor(event.getSessionId())) {
            ForgeMatchSession session = activeMatches.get(subscription.matchId());
            if (session != null) {
                UUID playerId = session.getPlayerIdForIndex(subscription.playerIndex());
                if (playerId != null) {
                    reportDisconnect(subscription.matchId(), playerId);
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private SupabaseDeck requireOwnedDeck(UUID deckId, UUID playerId, String message, UUID eventId) {
        SupabaseDeck deck = supabase.findDeck(deckId)
                .orElseThrow(() -> new IllegalArgumentException(message));
        if (!deck.playerId().equals(playerId)) {
            throw new IllegalArgumentException(message);
        }
        List<DeckProblem> problems = supabase.validateDeck(deckId, eventId);
        if (!problems.isEmpty()) {
            throw new IllegalArgumentException(message + ": " + problems.get(0).message());
        }
        return deck;
    }

    private SupabaseEvent resolveEvent(UUID eventId) {
        if (eventId == null) {
            return null;
        }
        SupabaseEvent event = supabase.findEvent(eventId)
                .orElseThrow(() -> new IllegalArgumentException("Event not found or not active"));
        if (!event.active()) {
            throw new IllegalArgumentException("Event is not active");
        }
        Instant start = toInstant(event.startTime());
        Instant end = toInstant(event.endTime());
        Instant now = Instant.now();
        if (start != null && start.isAfter(now)) {
            throw new IllegalArgumentException("Event has not started");
        }
        if (end != null && end.isBefore(now)) {
            throw new IllegalArgumentException("Event has ended");
        }
        return event;
    }

    private Instant toInstant(String ts) {
        if (ts == null || ts.isBlank()) {
            return null;
        }
        try {
            return ZonedDateTime.parse(ts).toInstant();
        } catch (Exception e) {
            return null;
        }
    }

    private String generateUniqueBattleCode() {
        for (int attempt = 0; attempt < 20; attempt++) {
            String code = randomCode();
            if (!supabase.battleCodeExists(code)) {
                return code;
            }
        }
        throw new IllegalStateException("Could not allocate a battle code");
    }

    private String randomCode() {
        StringBuilder sb = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            sb.append(CODE_ALPHABET.charAt(random.nextInt(CODE_ALPHABET.length())));
        }
        return sb.toString();
    }
}