package com.campusforge.battleengine.battle;

import forge.game.GameView;
import forge.headless.ChoiceRequest;
import forge.headless.GameStateSerializer;
import forge.headless.HeadlessMatch;
import forge.headless.HumanLobbyPlayer;
import forge.headless.HumanPlayerController;
import forge.headless.RemoteLobbyPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Runs one Forge match and streams serialized game state to per-player WebSocket
 * topics {@code /topic/match/{id}/p{index}}. Same contract as the backend's
 * session: pending decisions are private to each player; the common battlefield/
 * stack/life state goes to both. Headless engine state is entirely in-memory.
 */
public class ForgeMatchSession implements Consumer<Map<String, Object>> {

    private static final Logger log = LoggerFactory.getLogger(ForgeMatchSession.class);

    private final UUID matchId;
    private final UUID player1Id;
    private final String player1Name;
    private final UUID player2Id;
    private final String player2Name;
    private final HeadlessMatch headless;
    private final SimpMessagingTemplate messaging;
    private final Consumer<ForgeMatchSession> onGameOver;
    private final AtomicBoolean canceled = new AtomicBoolean(false);

    private final HumanPlayerController human1;
    private final HumanPlayerController human2;
    private final Set<UUID> disconnected = ConcurrentHashMap.newKeySet();

    private volatile Map<String, Object> latestState;

    public ForgeMatchSession(UUID matchId,
                             forge.deck.Deck deck1, UUID player1Id, String player1Name,
                             forge.deck.Deck deck2, UUID player2Id, String player2Name,
                             SimpMessagingTemplate messaging,
                             Consumer<ForgeMatchSession> onGameOver) {
        this.matchId = matchId;
        this.player1Id = player1Id;
        this.player1Name = player1Name;
        this.player2Id = player2Id;
        this.player2Name = player2Name;
        this.messaging = messaging;
        this.onGameOver = onGameOver;

        HumanLobbyPlayer p1 = new HumanLobbyPlayer(player1Name);
        forge.LobbyPlayer p2;
        if (player2Id != null) {
            p2 = new HumanLobbyPlayer(player2Name);
        } else {
            p2 = new RemoteLobbyPlayer(player2Name);
        }

        this.headless = new HeadlessMatch(matchId.toString(), deck1, p1, deck2, p2, this);
        // The player who joined (seat 1 / the opponent) decides who goes first.
        this.headless.setStartingPlayerChooserIndex(1);

        this.human1 = p1.getController();
        this.human2 = player2Id != null ? ((HumanLobbyPlayer) p2).getController() : null;
        if (human1 != null) {
            human1.setOnChoiceRequested(this::publishNow);
        }
        if (human2 != null) {
            human2.setOnChoiceRequested(this::publishNow);
        }

        this.headless.onFinished(() -> {
            if (!canceled.get()) {
                onGameOver.accept(this);
            }
        });
    }

    public void start() {
        headless.start();
    }

    public void cancel() {
        canceled.set(true);
        if (human1 != null) {
            human1.triggerAiFallback();
        }
        if (human2 != null) {
            human2.triggerAiFallback();
        }
        log.info("Canceled match session {}", matchId);
    }

    public UUID getMatchId() {
        return matchId;
    }

    public UUID getPlayer1Id() {
        return player1Id;
    }

    public UUID getPlayer2Id() {
        return player2Id;
    }

    public UUID getPlayerIdForIndex(int index) {
        return index == 0 ? player1Id : player2Id;
    }

    public Map<String, Object> getLatestState() {
        return latestState;
    }

    /**
     * Latest state enriched for a specific player: their own hand plus the
     * decision currently waiting on them. Used by the REST catch-up endpoint so
     * a reconnecting client sees its pending choice even while the engine is
     * blocked waiting for input.
     */
    public Map<String, Object> getLatestStateForPlayer(UUID playerId) {
        int index = playerId.equals(player1Id) ? 0 : (player2Id != null && playerId.equals(player2Id) ? 1 : -1);
        if (index < 0) {
            return null;
        }
        try {
            GameView view = headless.getGame().getView();
            Map<String, Object> common = latestState;
            if (common == null) {
                common = GameStateSerializer.serialize(view);
            }
            return buildForPlayer(index, common, view);
        } catch (Throwable t) {
            log.warn("Failed to build state for player {} in match {}", playerId, matchId, t);
            return null;
        }
    }

    public boolean isFinished() {
        return headless.isFinished();
    }

    /** Maps the winner lobby name to the player id (or null for the bot). */
    public UUID getWinnerPlayerId() {
        Map<String, Object> state = latestState;
        if (state == null) {
            return null;
        }
        String winnerName = (String) state.get("winnerName");
        if (winnerName == null) {
            return null;
        }
        if (winnerName.equals(player1Name)) {
            return player1Id;
        }
        if (player2Id != null && winnerName.equals(player2Name)) {
            return player2Id;
        }
        return null;
    }

    /** Forge game-end reason (e.g. AllOpponentsLost, Decked, Conceded) from the final state. */
    public String getWinCondition() {
        Map<String, Object> state = latestState;
        return state == null ? null : (String) state.get("winCondition");
    }

    /** Routes a player's answer to the matching controller. Returns false if rejected. */
    public boolean submitChoice(UUID playerId, long requestId, List<Integer> selectedIndices) {
        HumanPlayerController controller = controllerFor(playerId);
        if (controller == null) {
            return false;
        }
        return controller.submitChoice(requestId, selectedIndices);
    }

    /** Marks a player disconnected (grace period bookkeeping). */
    public void markDisconnected(UUID playerId) {
        disconnected.add(playerId);
        log.info("Player {} marked disconnected in match {}", playerId, matchId);
        publishInfo(nameFor(playerId) + " lost connection. They have 60 seconds to return.");
    }

    /** Clears a player's disconnected flag; called on any activity from them. */
    public void onPlayerActivity(UUID playerId) {
        boolean wasDisconnected = disconnected.contains(playerId);
        disconnected.remove(playerId);
        if (wasDisconnected) {
            log.info("Player {} reconnected in match {}", playerId, matchId);
            publishInfo(nameFor(playerId) + " reconnected.");
        }
    }

    public boolean isStillDisconnected(UUID playerId) {
        return disconnected.contains(playerId);
    }

    private HumanPlayerController controllerFor(UUID playerId) {
        if (playerId.equals(player1Id)) {
            return human1;
        }
        if (player2Id != null && playerId.equals(player2Id)) {
            return human2;
        }
        return null;
    }

    private String nameFor(UUID playerId) {
        if (playerId.equals(player1Id)) {
            return player1Name;
        }
        if (player2Id != null && playerId.equals(player2Id)) {
            return player2Name;
        }
        return "A player";
    }

    /** Sends an informational notice (not game state) to both seats. */
    private void publishInfo(String message) {
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("type", "info");
        info.put("message", message);
        info.put("matchId", matchId.toString());
        messaging.convertAndSend("/topic/match/" + matchId + "/p0", info);
        if (player2Id != null) {
            messaging.convertAndSend("/topic/match/" + matchId + "/p1", info);
        }
    }

    /**
     * Called the moment a decision is requested for one of the humans. Builds a
     * fresh snapshot from the live game view so a client that connected late
     * (or reconnected) still receives the current board plus the pending
     * decision, even while the engine thread is blocked awaiting input.
     */
    private void publishNow() {
        try {
            GameView view = headless.getGame().getView();
            Map<String, Object> state = GameStateSerializer.serialize(view);
            Map<String, Object> msg = new HashMap<>(state);
            msg.put("matchId", matchId.toString());
            msg.put("player1Id", player1Id.toString());
            msg.put("player2Id", player2Id != null ? player2Id.toString() : null);
            latestState = msg;
            publish(msg);
        } catch (Throwable t) {
            log.warn("Failed to publish decision state for match {}", matchId, t);
        }
    }

    @Override
    public void accept(Map<String, Object> state) {
        if (canceled.get()) {
            return;
        }
        Map<String, Object> msg = new HashMap<>(state);
        msg.put("matchId", matchId.toString());
        msg.put("player1Id", player1Id.toString());
        msg.put("player2Id", player2Id != null ? player2Id.toString() : null);
        try {
            GameView view = headless.getGame().getView();
            boolean over = view.isMatchOver() || headless.isFinished();
            msg.put("gameOver", over);
            if (over) {
                msg.put("status", "COMPLETED");
                msg.put("winnerName", view.getWinningPlayerName());
            }
        } catch (Throwable ignored) {
            // state enrichment is best-effort
        }
        latestState = msg;
        publish(msg);
    }

    private void publish(Map<String, Object> common) {
        try {
            GameView view = headless.getGame().getView();
            publishForPlayer(0, common, view);
            if (player2Id != null) {
                publishForPlayer(1, common, view);
            }
        } catch (Throwable t) {
            log.warn("Failed to publish state for match {}", matchId, t);
        }
    }

    private void publishForPlayer(int index, Map<String, Object> common, GameView view) {
        Map<String, Object> msg = buildForPlayer(index, common, view);
        messaging.convertAndSend("/topic/match/" + matchId + "/p" + index, msg);
    }

    private Map<String, Object> buildForPlayer(int index, Map<String, Object> common, GameView view) {
        Map<String, Object> msg = new HashMap<>(common);

        List<Map<String, Object>> players = new ArrayList<>();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commonPlayers = (List<Map<String, Object>>) common.get("players");
        if (commonPlayers != null) {
            for (Map<String, Object> p : commonPlayers) {
                players.add(new LinkedHashMap<>(p));
            }
        }
        msg.put("players", players);

        List<Map<String, Object>> hand = GameStateSerializer.serializeHand(view, index);
        Map<String, Object> me = players.isEmpty() ? new LinkedHashMap<>() : players.get(index);
        me.put("hand", hand);

        HumanPlayerController controller = index == 0 ? human1 : human2;
        ChoiceRequest pending = controller != null ? controller.getPendingRequest() : null;
        msg.put("pendingChoice", pending == null ? null : choiceToMap(pending));

        return msg;
    }

    private Map<String, Object> choiceToMap(ChoiceRequest request) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("requestId", request.getId());
        m.put("type", request.getType());
        m.put("prompt", request.getPrompt());
        m.put("cancellable", request.isCancellable());
        m.put("minCount", request.getMinCount());
        m.put("maxCount", request.getMaxCount());
        List<Map<String, Object>> options = new ArrayList<>();
        for (ChoiceRequest.ChoiceOption option : request.getOptions()) {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("label", option.getLabel());
            o.put("value", option.getValue());
            if (option.getCardId() != null) {
                o.put("cardId", option.getCardId());
            }
            options.add(o);
        }
        m.put("options", options);
        return m;
    }
}