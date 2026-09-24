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
import forge.game.event.GameEventGameFinished;
import forge.game.player.RegisteredPlayer;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;

/**
 * Standalone proof that the stripped Forge engine can run a full match headless:
 * two AI players play a real game and the resulting game state is emitted as JSON.
 *
 * <p>Run with the working directory set to {@code forge-engine}:</p>
 * <pre>
 *   java -cp forge-headless/target/forge-headless-2.0.14-SNAPSHOT.jar:... com...HeadlessRunner
 * </pre>
 */
public final class HeadlessRunner {

    private HeadlessRunner() {}

    public static void main(String[] args) {
        ForgeBootstrap.init();

        Deck deckA = TestDecks.build("Headless Aggro A", 60);
        Deck deckB = TestDecks.build("Headless Aggro B", 60);

        List<RegisteredPlayer> players = new ArrayList<>();
        players.add(new RegisteredPlayer(deckA).setPlayer(new LobbyPlayerAi("Bot-A", EnumSet.of(AIOption.USE_HYBRID_SIMULATION))));
        players.add(new RegisteredPlayer(deckB).setPlayer(new LobbyPlayerAi("Bot-B", EnumSet.of(AIOption.USE_HYBRID_SIMULATION))));

        GameRules rules = new GameRules(GameType.Constructed);
        rules.setGamesPerMatch(1);

        Match match = new Match(rules, players, "headless-ai-proof");
        Game game = match.createGame();

        StateEmitter emitter = new StateEmitter(game);
        game.subscribeToEvents(emitter);

        System.out.println("=== starting headless match ===");
        match.startGame(game);

        emitter.finish();

        GameOutcome outcome = game.getOutcome();
        System.out.println("=== match finished ===");
        System.out.println("gameOver=" + game.isGameOver());
        System.out.println("winCondition=" + outcome.getWinCondition());
        System.out.println("winner=" + (outcome.getWinningLobbyPlayer() == null ? "none" : outcome.getWinningLobbyPlayer().getName()));
        System.out.println("snapshotsEmitted=" + emitter.snapshotCount);
        System.out.println("done");
    }

    /** Subscribes to game events and emits a JSON state snapshot whenever turn/phase changes. */
    public static final class StateEmitter {
        private final GameView view;
        private final StringBuilder log = new StringBuilder();
        private String lastKey = "";
        private int snapshotCount;

        public StateEmitter(Game game) {
            this.view = game.getView();
        }

        @Subscribe
        public void onEvent(Event event) {
            String key = view.getTurn() + "/" + (view.getPhase() == null ? "" : view.getPhase().name());
            if (!key.equals(lastKey)) {
                lastKey = key;
                emit();
            }
        }

        private void emit() {
            snapshotCount++;
            Map<String, Object> state = GameStateSerializer.serialize(view);
            System.out.println("STATE " + state);
            log.append(state).append('\n');
        }

        public void finish() {
            emit();
        }

        public int getSnapshotCount() {
            return snapshotCount;
        }
    }

    /** Ensure the finished-event fires a final snapshot. */
    public static void registerFinished(Game game, StateEmitter emitter) {
        game.subscribeToEvents(new Object() {
            @Subscribe
            public void onFinished(GameEventGameFinished e) {
                emitter.finish();
            }
        });
    }
}
