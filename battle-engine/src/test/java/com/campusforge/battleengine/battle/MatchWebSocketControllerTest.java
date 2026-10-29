package com.campusforge.battleengine.battle;

import com.campusforge.battleengine.security.SupabaseJwt.BattleIdentity;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MatchWebSocketControllerTest {

    @Test
    void acknowledgesChoiceOnOnlyTheAuthenticatedPlayersSeat() {
        UUID matchId = UUID.randomUUID();
        UUID playerId = UUID.randomUUID();
        MatchManager manager = mock(MatchManager.class);
        SimpMessagingTemplate messaging = mock(SimpMessagingTemplate.class);
        when(manager.playerIndex(matchId, playerId)).thenReturn(1);
        when(manager.handleAction(eq(matchId), eq(playerId), eq("CHOICE"), any())).thenReturn(true);
        MatchWebSocketController controller = new MatchWebSocketController(manager, messaging);
        var authentication = new UsernamePasswordAuthenticationToken(
                new BattleIdentity(playerId, null), null, List.of());
        Map<String, Object> message = Map.of(
                "actionType", "CHOICE",
                "payload", Map.of("requestId", 42, "selectedIndices", List.of(0)));

        controller.handleAction(matchId, message, authentication);

        ArgumentCaptor<Map> acknowledgement = ArgumentCaptor.forClass(Map.class);
        verify(messaging).convertAndSend(eq("/topic/match/" + matchId + "/p1"), acknowledgement.capture());
        assertEquals("action-ack", acknowledgement.getValue().get("type"));
        assertEquals(42L, acknowledgement.getValue().get("requestId"));
        assertEquals(true, acknowledgement.getValue().get("accepted"));
    }

    @Test
    void doesNotAcknowledgeActionsForPlayersOutsideTheMatch() {
        UUID matchId = UUID.randomUUID();
        UUID playerId = UUID.randomUUID();
        MatchManager manager = mock(MatchManager.class);
        SimpMessagingTemplate messaging = mock(SimpMessagingTemplate.class);
        when(manager.playerIndex(matchId, playerId)).thenReturn(-1);
        MatchWebSocketController controller = new MatchWebSocketController(manager, messaging);
        var authentication = new UsernamePasswordAuthenticationToken(
                new BattleIdentity(playerId, null), null, List.of());
        Map<String, Object> message = Map.of(
                "actionType", "CHOICE",
                "payload", Map.of("requestId", 42, "selectedIndices", List.of(0)));

        controller.handleAction(matchId, message, authentication);

        verify(manager, never()).handleAction(any(), any(), any(), any());
        verify(messaging, never()).convertAndSend(any(String.class), any(Object.class));
    }
}
