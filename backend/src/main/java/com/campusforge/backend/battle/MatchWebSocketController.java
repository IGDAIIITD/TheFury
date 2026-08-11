package com.campusforge.backend.battle;

import com.campusforge.backend.security.PlayerPrincipal;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;

import java.util.Map;
import java.util.UUID;

/**
 * Receives player actions over STOMP. Game state is pushed to
 * {@code /topic/match/{id}/p{playerIndex}} by the {@link ForgeMatchSession}
 * itself, so this controller only forwards actions into the running session.
 * The acting player is taken from the authenticated WebSocket session, never
 * from the message payload.
 */
@Controller
public class MatchWebSocketController {

    private final MatchManager matchManager;

    public MatchWebSocketController(MatchManager matchManager) {
        this.matchManager = matchManager;
    }

    @MessageMapping("/match/{matchId}/action")
    public void handleAction(@DestinationVariable UUID matchId,
                             @Payload Map<String, Object> message,
                             Authentication authentication) {
        UUID playerId = resolvePlayerId(authentication);
        if (playerId == null) {
            return;
        }

        String actionType = message != null ? (String) message.get("actionType") : null;
        Object payload = message != null ? message.get("payload") : null;
        if (actionType != null) {
            matchManager.handleAction(matchId, playerId, actionType, payload);
        }
    }

    private UUID resolvePlayerId(Authentication authentication) {
        if (authentication != null && authentication.getPrincipal() instanceof PlayerPrincipal principal) {
            return principal.getPlayer().getId();
        }
        return null;
    }
}
