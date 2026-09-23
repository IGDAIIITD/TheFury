package com.campusforge.backend.battle;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.common.LevelService;
import com.campusforge.backend.common.events.MatchWonEvent;
import com.campusforge.backend.deck.Deck;
import com.campusforge.backend.deck.DeckRepository;
import com.campusforge.backend.deck.DeckValidationService;
import com.campusforge.backend.deck.dto.DeckCardRequest;
import com.campusforge.backend.deck.dto.ValidateDeckRequest;
import com.campusforge.backend.events.Event;
import com.campusforge.backend.events.EventService;
import com.campusforge.backend.security.StompAuthChannelInterceptor;
import forge.headless.TestDecks;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Service
public class MatchManager implements BattleAdapter {

    private static final Logger log = LoggerFactory.getLogger(MatchManager.class);
    private static final long DISCONNECT_GRACE_SECONDS = 60;
    private static final String CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final int CODE_LENGTH = 6;

    private final MatchRepository matchRepository;
    private final PlayerRepository playerRepository;
    private final DeckRepository deckRepository;
    private final DeckValidationService validationService;
    private final ForgeDeckConverter deckConverter;
    private final SimpMessagingTemplate messaging;
    private final TransactionTemplate tx;
    private final FeatureFlags featureFlags;
    private final StompAuthChannelInterceptor stompAuthChannelInterceptor;
    private final EventService eventService;
    private final ApplicationEventPublisher publisher;
    private final SecureRandom random = new SecureRandom();
    private final ScheduledExecutorService scheduler = new ScheduledThreadPoolExecutor(2, r -> {
        Thread t = new Thread(r, "battle-grace");
        t.setDaemon(true);
        return t;
    });

    // Active Forge matches, keyed by match id
    private final ConcurrentHashMap<UUID, ForgeMatchSession> activeMatches = new ConcurrentHashMap<>();

    public MatchManager(MatchRepository matchRepository,
                        PlayerRepository playerRepository,
                        DeckRepository deckRepository,
                        DeckValidationService validationService,
                        ForgeDeckConverter deckConverter,
                        SimpMessagingTemplate messaging,
                        org.springframework.transaction.PlatformTransactionManager transactionManager,
                        FeatureFlags featureFlags,
                        StompAuthChannelInterceptor stompAuthChannelInterceptor,
                        EventService eventService,
                        ApplicationEventPublisher publisher) {
        this.matchRepository = matchRepository;
        this.playerRepository = playerRepository;
        this.deckRepository = deckRepository;
        this.validationService = validationService;
        this.deckConverter = deckConverter;
        this.messaging = messaging;
        this.tx = new TransactionTemplate(transactionManager);
        this.featureFlags = featureFlags;
        this.stompAuthChannelInterceptor = stompAuthChannelInterceptor;
        this.eventService = eventService;
        this.publisher = publisher;
    }

    // ------------------------------------------------------------------
    // Match creation
    // ------------------------------------------------------------------

    @Transactional
    public Match createMatch(UUID player1Id, UUID deck1Id, UUID player2Id, UUID deck2Id, UUID eventId) {
        if (player2Id == null && !featureFlags.isAiBattlesEnabled()) {
            throw new IllegalArgumentException("AI battles are disabled");
        }
        Player p1 = playerRepository.findById(player1Id)
                .orElseThrow(() -> new IllegalArgumentException("Player 1 not found"));
        Deck d1 = deckRepository.findById(deck1Id)
                .orElseThrow(() -> new IllegalArgumentException("Deck 1 not found"));
        Event event = resolveEvent(eventId);
        validateDeck(p1, d1, "Player 1 deck is invalid for match", event);

        Player p2 = null;
        Deck d2 = null;
        if (player2Id != null) {
            p2 = playerRepository.findById(player2Id).orElse(null);
        }
        if (deck2Id != null && p2 != null) {
            d2 = deckRepository.findById(deck2Id).orElse(null);
            if (d2 != null) {
                validateDeck(p2, d2, "Player 2 deck is invalid for event match", event);
            }
        }

        Match match = new Match(p1, d1, p2, d2);
        match.setEvent(event);
        match = matchRepository.save(match);

        startGame(match.getId(), p1.getId(), d1.getId(), p2 != null ? p2.getId() : null, d2 != null ? d2.getId() : null);
        return match;
    }

    /** Creates a waiting room for a human-vs-human battle and returns a shareable code. */
    @Transactional
    public Match createLobbyMatch(UUID player1Id, UUID deck1Id, UUID eventId) {
        Player p1 = playerRepository.findById(player1Id)
                .orElseThrow(() -> new IllegalArgumentException("Player not found"));
        Deck d1 = deckRepository.findById(deck1Id)
                .orElseThrow(() -> new IllegalArgumentException("Deck not found"));
        Event event = resolveEvent(eventId);
        validateDeck(p1, d1, "Deck is invalid for battle", event);

        Match match = new Match(p1, d1, null, null);
        match.setEvent(event);
        match.setStatus(Match.MatchStatus.PENDING);
        match.setBattleCode(generateUniqueBattleCode());
        return matchRepository.save(match);
    }

    /** Joins a pending battle by code, making it active and starting the game. */
    @Transactional
    public Match joinMatch(String code, UUID player2Id, UUID deck2Id) {
        if (code == null || code.isBlank()) {
            throw new IllegalArgumentException("Battle code is required");
        }
        Match match = matchRepository.findByBattleCode(code.trim().toUpperCase())
                .orElseThrow(() -> new IllegalArgumentException("Battle code not found"));
        if (!Match.MatchStatus.PENDING.equals(match.getStatus())) {
            throw new IllegalStateException("Battle is no longer open");
        }
        if (match.getPlayer1().getId().equals(player2Id)) {
            throw new IllegalArgumentException("Cannot join your own battle");
        }
        Player p2 = playerRepository.findById(player2Id)
                .orElseThrow(() -> new IllegalArgumentException("Player not found"));
        Deck d2 = deckRepository.findById(deck2Id)
                .orElseThrow(() -> new IllegalArgumentException("Deck not found"));
        validateDeck(p2, d2, "Deck is invalid for battle", match.getEvent());

        match.setPlayer2(p2);
        match.setDeck2(d2);
        match.setStatus(Match.MatchStatus.ACTIVE);
        match = matchRepository.save(match);

        startGame(match.getId(), match.getPlayer1().getId(), match.getDeck1().getId(), p2.getId(), d2.getId());
        return match;
    }

    @Override
    @Transactional
    public void startGame(UUID matchId, UUID player1Id, UUID deck1Id, UUID player2Id, UUID deck2Id) {
        Player p1 = playerRepository.findById(player1Id)
                .orElseThrow(() -> new IllegalArgumentException("Player 1 not found"));
        Deck d1 = deckRepository.findById(deck1Id)
                .orElseThrow(() -> new IllegalArgumentException("Deck 1 not found"));
        forge.deck.Deck forgeDeck1 = deckConverter.toForgeDeck(d1);

        forge.deck.Deck forgeDeck2;
        String player2Name;
        if (player2Id != null && deck2Id != null) {
            Player p2 = playerRepository.findById(player2Id).orElse(null);
            Deck d2 = deckRepository.findById(deck2Id).orElse(null);
            if (p2 == null || d2 == null) {
                throw new IllegalArgumentException("Opponent not found");
            }
            forgeDeck2 = deckConverter.toForgeDeck(d2);
            player2Name = p2.getDisplayName();
        } else {
            forgeDeck2 = TestDecks.build("Campus Bot", 60);
            player2Name = "Campus Bot";
        }

        ForgeMatchSession session = new ForgeMatchSession(
                matchId,
                forgeDeck1, player1Id, p1.getDisplayName(),
                forgeDeck2, player2Id, player2Name,
                messaging,
                s -> finishGame(matchId, s.getWinnerPlayerId(), s.getWinCondition()));

        ForgeMatchSession previous = activeMatches.put(matchId, session);
        if (previous != null) {
            previous.cancel();
        }
        session.start();
        log.info("Started Forge match session {} ({} vs {})", matchId, p1.getDisplayName(), player2Name);
    }

    @Override
    public void finishGame(UUID matchId, UUID winnerId, String winCondition) {
        final Match[] resolved = new Match[1];
        tx.executeWithoutResult(status -> matchRepository.findById(matchId).ifPresent(m -> {
            m.setStatus(Match.MatchStatus.COMPLETED);
            m.setWinnerId(winnerId);
            m.setWinCondition(winCondition);
            m.setEndedAt(LocalDateTime.now());
            matchRepository.save(m);
            resolved[0] = m;
            log.info("Match {} finished, winner={}, condition={}", matchId, winnerId, winCondition);
        }));
        rewardWinner(resolved[0], winnerId);
        activeMatches.remove(matchId);
    }

    @Override
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

    @Override
    public void reportConcede(UUID matchId, UUID playerId) {
        final UUID[] resolvedWinner = new UUID[1];
        final Match[] resolvedMatch = new Match[1];
        tx.executeWithoutResult(status -> matchRepository.findById(matchId).ifPresent(m -> {
            m.setStatus(Match.MatchStatus.CONCEDED);
            UUID winnerId = m.getPlayer1().getId().equals(playerId) ?
                    (m.getPlayer2() != null ? m.getPlayer2().getId() : null) : m.getPlayer1().getId();
            m.setWinnerId(winnerId);
            m.setEndedAt(LocalDateTime.now());
            matchRepository.save(m);
            resolvedWinner[0] = winnerId;
            resolvedMatch[0] = m;
        }));
        rewardWinner(resolvedMatch[0], resolvedWinner[0]);
        ForgeMatchSession session = activeMatches.remove(matchId);
        if (session != null) {
            // Push terminal state to both players BEFORE canceling so the
            // remaining player sees "You Lose" instead of being stuck.
            Match m = resolvedMatch[0];
            String winnerName = null;
            if (resolvedWinner[0] != null && m != null) {
                Player winner = m.getPlayer1().getId().equals(resolvedWinner[0])
                        ? m.getPlayer1() : m.getPlayer2();
                if (winner != null) winnerName = winner.getDisplayName();
            }
            Map<String, Object> terminal = new java.util.LinkedHashMap<>();
            terminal.put("gameOver", true);
            terminal.put("status", "CONCEDED");
            terminal.put("winnerId", resolvedWinner[0] != null ? resolvedWinner[0].toString() : null);
            terminal.put("winnerName", winnerName);
            terminal.put("winCondition", "Conceded");
            terminal.put("matchId", matchId.toString());
            messaging.convertAndSend("/topic/match/" + matchId + "/p0", terminal);
            messaging.convertAndSend("/topic/match/" + matchId + "/p1", terminal);
            session.cancel();
        }
    }

    private void rewardWinner(Match match, UUID winnerId) {
        if (winnerId == null) {
            return;
        }
        long base = 50;
        long xp = base;
        Event event = match != null ? match.getEvent() : null;
        LocalDateTime now = LocalDateTime.now();
        if (event != null && event.isActive()
                && !event.getStartTime().isAfter(now) && !event.getEndTime().isBefore(now)) {
            xp = Math.round(base * event.getBonusMultiplier().doubleValue());
        }
        final long awarded = xp;
        playerRepository.findById(winnerId).ifPresent(winner -> {
            winner.setExperience(winner.getExperience() + awarded);
            winner.setLevel(LevelService.levelFor(winner.getExperience()));
            playerRepository.save(winner);
            publisher.publishEvent(new MatchWonEvent(winnerId, winner.getDisplayName(), awarded));
            log.info("Awarded {} XP to match winner {}", awarded, winnerId);
        });
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
        for (StompAuthChannelInterceptor.Subscription subscription : stompAuthChannelInterceptor.subscriptionsFor(event.getSessionId())) {
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

    private void validateDeck(Player owner, Deck deck, String message) {
        validateDeck(owner, deck, message, null);
    }

    private void validateDeck(Player owner, Deck deck, String message, Event event) {
        var validation = validationService.validate(owner, new ValidateDeckRequest(
                deck.getFormatCode(), deck.getCommander() != null ? deck.getCommander().getId() : null,
                deck.getCards().stream().map(c -> new DeckCardRequest(c.getCard().getId(), c.getQuantity())).toList()
        ), event);
        if (!validation.valid()) {
            throw new IllegalArgumentException(message);
        }
    }

    private Event resolveEvent(UUID eventId) {
        if (eventId == null) {
            return null;
        }
        return eventService.requireActive(eventId, LocalDateTime.now());
    }

    private String generateUniqueBattleCode() {
        for (int attempt = 0; attempt < 20; attempt++) {
            String code = randomCode();
            if (matchRepository.findByBattleCode(code).isEmpty()) {
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
