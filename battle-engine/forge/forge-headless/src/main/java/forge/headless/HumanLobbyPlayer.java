package forge.headless;

import forge.LobbyPlayer;
import forge.game.Game;
import forge.game.player.IGameEntitiesFactory;
import forge.game.player.Player;
import forge.game.player.PlayerController;

/**
 * A lobby player whose in-game entity is a {@link HumanPlayerController}, so
 * the game thread blocks on the web client's input for every decision. The
 * created controller is retained so the session can route answers to it.
 */
public class HumanLobbyPlayer extends LobbyPlayer implements IGameEntitiesFactory {

    private volatile HumanPlayerController controller;

    public HumanLobbyPlayer(String name) {
        super(name);
    }

    @Override
    public Player createIngamePlayer(Game game, int id) {
        Player player = new Player(getName(), game, id);
        HumanPlayerController c = new HumanPlayerController(game, player, this);
        this.controller = c;
        player.setFirstController(c);
        return player;
    }

    @Override
    public PlayerController createMindSlaveController(Player master, Player slave) {
        return new HumanPlayerController(master.getGame(), slave, this);
    }

    @Override
    public void hear(LobbyPlayer player, String message) {
        // TODO: surface chat/notices to the web client.
    }

    /** The controller created for this player, or null if the game hasn't started. */
    public HumanPlayerController getController() {
        return controller;
    }
}
