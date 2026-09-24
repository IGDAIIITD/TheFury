package forge.headless;

import com.google.common.eventbus.Subscribe;
import forge.ai.AIOption;
import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameOutcome;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.GameView;
import forge.game.Match;
import forge.game.event.Event;
import forge.game.player.RegisteredPlayer;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Runs a single Forge match on a background thread and streams serialized game
 * state snapshots to a listener, throttled so a live board stays responsive
 * without flooding the WebSocket.
 *
 * <p>State is emitted at most every {@link #EMIT_INTERVAL_MS} milliseconds, plus
 * always on phase/turn changes and once more when the game finishes. The latest
 * snapshot is retained so reconnect/fetch endpoints can return it immediately.</p>
 */
public class HeadlessMatch {

    /** Life total both players start with (standard Magic). The web battle board's health bar assumes 20. */
    public static final int STARTING_LIFE = 20;

    public static final long EMIT_INTERVAL_MS = 50;

    private final Game game;
    private final Match forgeMatch;
    private final GameRules rules;
    private final Thread thread;
    private final Consumer<Map<String, Object>> stateListener;
    private final List<Runnable> finishedListeners = new ArrayList<>();
    private final AtomicBoolean finished = new AtomicBoolean(false);
    private final GameView view;

    private volatile Map<String, Object> latestState;
    private volatile long lastEmitNanos = 0;
    private String lastPhaseKey = "";

    public HeadlessMatch(String name, Deck deckA, forge.LobbyPlayer playerA,
                         Deck deckB, forge.LobbyPlayer playerB,
                         Consumer<Map<String, Object>> stateListener) {
        this.stateListener = stateListener;

        List<RegisteredPlayer> players = new ArrayList<>();
        RegisteredPlayer rpA = new RegisteredPlayer(deckA);
        rpA.setPlayer(playerA);
        rpA.setStartingLife(STARTING_LIFE);
        RegisteredPlayer rpB = new RegisteredPlayer(deckB);
        rpB.setPlayer(playerB);
        rpB.setStartingLife(STARTING_LIFE);
        players.add(rpA);
        players.add(rpB);

        GameRules rules = new GameRules(GameType.Constructed);
        rules.setGamesPerMatch(1);
        this.rules = rules;

        this.forgeMatch = new Match(rules, players, name);
        this.game = forgeMatch.createGame();
        this.view = game.getView();

        game.subscribeToEvents(new Object() {
            @Subscribe
            public void onEvent(Event event) {
                maybeEmit();
            }
        });

        this.thread = new Thread(() -> {
            try {
                forgeMatch.startGame(game);
            } catch (Throwable t) {
                t.printStackTrace();
            } finally {
                finished.set(true);
                emitFinal();
                List<Runnable> listeners;
                synchronized (finishedListeners) {
                    listeners = new ArrayList<>(finishedListeners);
                }
                for (Runnable r : listeners) {
                    try {
                        r.run();
                    } catch (Throwable t) {
                        t.printStackTrace();
                    }
                }
            }
        }, "forge-match-" + name);
    }

    public void start() {
        thread.start();
    }

    /** Set which seat's controller is asked who goes first (-1 = random). Must be called before start(). */
    public void setStartingPlayerChooserIndex(int index) {
        rules.setStartingPlayerChooserIndex(index);
    }

    public void onFinished(Runnable r) {
        synchronized (finishedListeners) {
            finishedListeners.add(r);
        }
        if (finished.get()) {
            r.run();
        }
    }

    public Map<String, Object> getLatestState() {
        return latestState;
    }

    public boolean isFinished() {
        return finished.get();
    }

    public Game getGame() {
        return game;
    }

    public GameOutcome getOutcome() {
        return game.getOutcome();
    }

    private void maybeEmit() {
        long now = System.nanoTime();
        boolean phaseChanged = !phaseKey().equals(lastPhaseKey);
        if (!phaseChanged || now - lastEmitNanos > EMIT_INTERVAL_MS * 1_000_000L) {
            emit();
        }
    }

    private String phaseKey() {
        return view.getTurn() + "/" + (view.getPhase() == null ? "" : view.getPhase().name());
    }

    private void emitFinal() {
        Map<String, Object> state = latestState == null ? new java.util.LinkedHashMap<>() : new java.util.LinkedHashMap<>(latestState);
        state.put("gameOver", true);
        GameOutcome outcome = game.getOutcome();
        state.put("winCondition", outcome == null || outcome.getWinCondition() == null
                ? null : outcome.getWinCondition().name());
        RegisteredPlayer winner = outcome == null ? null : outcome.getWinningPlayer();
        state.put("winnerName", winner == null || winner.getPlayer() == null
                ? null : winner.getPlayer().getName());
        latestState = state;
        try {
            stateListener.accept(state);
        } catch (Throwable t) {
            t.printStackTrace();
        }
    }

    private void emit() {
        lastPhaseKey = phaseKey();
        lastEmitNanos = System.nanoTime();
        Map<String, Object> state = GameStateSerializer.serialize(view);
        latestState = state;
        try {
            stateListener.accept(state);
        } catch (Throwable t) {
            t.printStackTrace();
        }
    }

    /** Convenience factory for the "Campus Bot" AI opponent. */
    public static LobbyPlayerAi aiOpponent(String name) {
        return new LobbyPlayerAi(name, EnumSet.of(AIOption.USE_HYBRID_SIMULATION));
    }
}
