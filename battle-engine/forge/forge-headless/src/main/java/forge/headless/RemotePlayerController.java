package forge.headless;

import forge.ai.AIOption;
import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.player.Player;
import forge.LobbyPlayer;

/**
 * A player controller for a remote (backend-driven) player. Decision-making
 * currently falls back to the AI so a match always progresses; human input is
 * wired in later by making the controller block on an input queue.
 */
public class RemotePlayerController extends PlayerControllerAi {

    public RemotePlayerController(Game game, Player player, LobbyPlayer lobbyPlayer) {
        super(game, player, lobbyPlayer);
        getAi().setUseSimulation(AIOption.USE_HYBRID_SIMULATION);
    }
}
