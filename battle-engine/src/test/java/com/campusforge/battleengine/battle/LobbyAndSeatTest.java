package com.campusforge.battleengine.battle;

import com.campusforge.battleengine.security.MatchSeatAccess;
import com.campusforge.battleengine.security.SupabaseJwt;
import com.campusforge.battleengine.security.SupabaseJwt.BattleIdentity;
import com.campusforge.battleengine.security.SupabaseStompAuthChannelInterceptor;
import com.campusforge.battleengine.supabase.SupabaseClient;
import com.campusforge.battleengine.supabase.SupabaseClient.SupabaseMatch;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Lobby expiry / cancel, and who may subscribe to a match seat. */
class LobbyAndSeatTest {

    private static final String CODE = "QWERTY";
    private final UUID matchId = UUID.randomUUID();
    private final UUID host = UUID.randomUUID();
    private final UUID joiner = UUID.randomUUID();
    private final UUID stranger = UUID.randomUUID();

    private SupabaseClient supabase;
    private MatchManager manager;

    @BeforeEach
    void setUp() {
        supabase = mock(SupabaseClient.class);
        manager = new MatchManager(supabase, mock(ForgeDeckConverter.class), mock(SimpMessagingTemplate.class),
                new FeatureFlags(false), mock(SupabaseStompAuthChannelInterceptor.class));
    }

    private SupabaseMatch match(String status, UUID player2, Instant created) {
        return new SupabaseMatch(matchId, host, player2, UUID.randomUUID(), null,
                status, null, null, CODE, null, created == null ? null : created.toString(), null);
    }

    @Test
    void joiningALobbyOlderThanTwoMinutesExpiresIt() {
        Instant old = Instant.now().minusSeconds(MatchManager.LOBBY_TTL_SECONDS + 5);
        when(supabase.findByBattleCode(CODE)).thenReturn(Optional.of(match("WAITING", null, old)));

        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> manager.joinMatch(CODE, joiner, UUID.randomUUID()));
        assertTrue(e.getMessage().contains("expired"));
        verify(supabase).closeLobby(matchId, "EXPIRED");
        verify(supabase, never()).activateMatch(any(), any(), any());
    }

    @Test
    void refreshLobbyClosesOnlyStaleWaitingLobbies() {
        SupabaseMatch fresh = match("WAITING", null, Instant.now());
        assertEquals(fresh, manager.refreshLobby(fresh));
        verify(supabase, never()).closeLobby(any(), any());

        SupabaseMatch stale = match("WAITING", null, Instant.now().minusSeconds(600));
        when(supabase.findMatch(matchId)).thenReturn(Optional.of(match("EXPIRED", null, Instant.now().minusSeconds(600))));
        assertEquals("EXPIRED", manager.refreshLobby(stale).status());
        verify(supabase).closeLobby(matchId, "EXPIRED");
    }

    @Test
    void onlyTheHostCanCancelTheirLobby() {
        when(supabase.findMatch(matchId)).thenReturn(Optional.of(match("WAITING", null, Instant.now())));

        assertThrows(IllegalArgumentException.class, () -> manager.cancelLobby(matchId, stranger));
        verify(supabase, never()).closeLobby(any(), any());

        manager.cancelLobby(matchId, host);
        verify(supabase).closeLobby(matchId, "CANCELLED");
    }

    @Test
    void seatsBelongToTheirPlayersWhenNoGameIsRunning() {
        when(supabase.findMatch(matchId)).thenReturn(Optional.of(match("ACTIVE", joiner, Instant.now())));

        assertTrue(manager.canWatchSeat(matchId, 0, host));
        assertTrue(manager.canWatchSeat(matchId, 1, joiner));
        assertFalse(manager.canWatchSeat(matchId, 1, host), "host must not see the joiner's hand");
        assertFalse(manager.canWatchSeat(matchId, 0, stranger));
        assertFalse(manager.canWatchSeat(matchId, 2, host));
    }

    @Test
    void subscribeIsRefusedForSomeoneElsesSeat() {
        MatchSeatAccess access = mock(MatchSeatAccess.class);
        when(access.canWatchSeat(matchId, 0, host)).thenReturn(true);
        @SuppressWarnings("unchecked")
        ObjectProvider<MatchSeatAccess> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(access);
        SupabaseStompAuthChannelInterceptor interceptor =
                new SupabaseStompAuthChannelInterceptor(mock(SupabaseJwt.class), provider);

        assertThrows(MessagingException.class, () -> interceptor.preSend(subscribe(joiner, "/topic/match/" + matchId + "/p0", "s1"), mock(MessageChannel.class)));
        assertFalse(interceptor.isSeatWatched(matchId, 0));

        assertDoesNotThrow(() -> interceptor.preSend(subscribe(host, "/topic/match/" + matchId + "/p0", "s2"), mock(MessageChannel.class)));
        assertTrue(interceptor.isSeatWatched(matchId, 0));
        verify(access).onSeatSubscribed(matchId, host);

        assertEquals(1, interceptor.subscriptionsFor("s2").size());
        assertFalse(interceptor.isSeatWatched(matchId, 0), "a closed socket no longer watches the seat");
    }

    private static Message<byte[]> subscribe(UUID player, String destination, String sessionId) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        accessor.setDestination(destination);
        accessor.setSessionId(sessionId);
        accessor.setSubscriptionId("sub-" + sessionId);
        accessor.setUser(new UsernamePasswordAuthenticationToken(new BattleIdentity(player, null), null, List.of()));
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}
