package com.campusforge.battleengine.battle;

import com.campusforge.battleengine.security.SupabaseJwt.BattleIdentity;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Receives player actions over STOMP. Game state is pushed to
 * {@code /topic/match/{id}/p{playerIndex}} by the {@link ForgeMatchSession}
 * itself, so this controller forwards choices into the running session and
 * acknowledges them on the authenticated player's seat topic.
 */
@Controller
public class MatchWebSocketController {

    private final MatchManager matchManager;
    private final SimpMessagingTemplate messaging;

    public MatchWebSocketController(MatchManager matchManager, SimpMessagingTemplate messaging) {
        this.matchManager = matchManager;
        this.messaging = messaging;
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
        if (!"CHOICE".equals(actionType) || !(payload instanceof Map<?, ?> choice)
                || !(choice.get("requestId") instanceof Number requestId)) {
            return;
        }
        int playerIndex = matchManager.playerIndex(matchId, playerId);
        if (playerIndex < 0) return;

        boolean accepted = matchManager.handleAction(matchId, playerId, actionType, payload);
        Map<String, Object> acknowledgement = new LinkedHashMap<>();
        acknowledgement.put("type", "action-ack");
        acknowledgement.put("requestId", requestId.longValue());
        acknowledgement.put("accepted", accepted);
        messaging.convertAndSend("/topic/match/" + matchId + "/p" + playerIndex, acknowledgement);
    }

    private UUID resolvePlayerId(Authentication authentication) {
        if (authentication != null && authentication.getPrincipal() instanceof BattleIdentity identity) {
            return identity.playerId();
        }
        return null;
    }
}