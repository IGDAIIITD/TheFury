package com.campusforge.battleengine.battle;

import com.campusforge.battleengine.security.SupabaseStompAuthChannelInterceptor;
import com.campusforge.battleengine.supabase.SupabaseClient;
import com.campusforge.battleengine.supabase.SupabaseClient.SupabaseDeck;
import com.campusforge.battleengine.supabase.SupabaseClient.SupabaseMatch;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Join is idempotent for the joiner and race-safe between joiners. */
class MatchManagerJoinTest {

    private static final String CODE = "FBKYXW";
    private final UUID matchId = UUID.randomUUID();
    private final UUID host = UUID.randomUUID();
    private final UUID joiner = UUID.randomUUID();
    private final UUID other = UUID.randomUUID();
    private final UUID hostDeck = UUID.randomUUID();
    private final UUID joinerDeck = UUID.randomUUID();

    private SupabaseClient supabase;
    private ForgeDeckConverter converter;
    private MatchManager manager;

    @BeforeEach
    void setUp() {
        supabase = mock(SupabaseClient.class);
        converter = mock(ForgeDeckConverter.class);
        manager = new MatchManager(supabase, converter, mock(SimpMessagingTemplate.class),
                new FeatureFlags(false), mock(SupabaseStompAuthChannelInterceptor.class));
        when(supabase.findDeck(joinerDeck)).thenReturn(Optional.of(
                new SupabaseDeck(joinerDeck, joiner, "Red-Green Starter", "STANDARD", null, List.of())));
        when(supabase.validateDeck(any(), any())).thenReturn(List.of());
    }

    private SupabaseMatch match(String status, UUID player2) {
        return new SupabaseMatch(matchId, host, player2, hostDeck, player2 == null ? null : joinerDeck,
                status, null, null, CODE, null, null, null);
    }

    @Test
    void repeatedJoinBySameplayerReturnsTheRunningMatch() {
        when(supabase.findByBattleCode(CODE)).thenReturn(Optional.of(match("ACTIVE", joiner)));

        assertEquals(matchId, manager.joinMatch(CODE, joiner, joinerDeck).id());
        verify(supabase, never()).activateMatch(any(), any(), any());
        verifyNoInteractions(converter); // no second Forge game
    }

    @Test
    void joiningSomeoneElsesRunningMatchIsAConflict() {
        when(supabase.findByBattleCode(CODE)).thenReturn(Optional.of(match("ACTIVE", other)));

        assertThrows(IllegalStateException.class, () -> manager.joinMatch(CODE, joiner, joinerDeck));
    }

    @Test
    void losingTheRaceToAnotherPlayerIsAConflict() {
        when(supabase.findByBattleCode(CODE)).thenReturn(Optional.of(match("WAITING", null)));
        when(supabase.activateMatch(matchId, joiner, joinerDeck)).thenReturn(Optional.empty());
        when(supabase.findMatch(matchId)).thenReturn(Optional.of(match("ACTIVE", other)));

        assertThrows(IllegalStateException.class, () -> manager.joinMatch(CODE, joiner, joinerDeck));
        verifyNoInteractions(converter);
    }

    @Test
    void losingTheRaceToOurOwnConcurrentRequestReturnsTheMatch() {
        when(supabase.findByBattleCode(CODE)).thenReturn(Optional.of(match("WAITING", null)));
        when(supabase.activateMatch(matchId, joiner, joinerDeck)).thenReturn(Optional.empty());
        when(supabase.findMatch(matchId)).thenReturn(Optional.of(match("ACTIVE", joiner)));

        assertEquals(matchId, manager.joinMatch(CODE, joiner, joinerDeck).id());
        verifyNoInteractions(converter);
    }

    @Test
    void finishedMatchesCannotBeJoined() {
        when(supabase.findByBattleCode(CODE)).thenReturn(Optional.of(match("FINISHED", joiner)));

        assertThrows(IllegalStateException.class, () -> manager.joinMatch(CODE, joiner, joinerDeck));
    }

    @Test
    void cannotJoinOwnLobby() {
        when(supabase.findByBattleCode(CODE)).thenReturn(Optional.of(match("WAITING", null)));

        assertThrows(IllegalArgumentException.class, () -> manager.joinMatch(CODE, host, hostDeck));
    }
}
