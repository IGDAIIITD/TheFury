package forge.headless;

import forge.LobbyPlayer;
import forge.game.Game;
import forge.game.player.IGameEntitiesFactory;
import forge.game.player.Player;
import forge.game.player.PlayerController;

/**
 * A lobby player whose in-game entity is created by the backend session.
 */
public class RemoteLobbyPlayer extends LobbyPlayer implements IGameEntitiesFactory {

    public RemoteLobbyPlayer(String name) {
        super(name);
    }

    @Override
    public Player createIngamePlayer(Game game, int id) {
        Player player = new Player(getName(), game, id);
        player.setFirstController(new RemotePlayerController(game, player, this));
        return player;
    }

    @Override
    public PlayerController createMindSlaveController(Player master, Player slave) {
        return new RemotePlayerController(master.getGame(), slave, this);
    }

    @Override
    public void hear(LobbyPlayer player, String message) {
    }
}
