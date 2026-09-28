package com.campusforge.battleengine.battle;

import com.campusforge.battleengine.security.SupabaseStompAuthChannelInterceptor;
import com.campusforge.battleengine.supabase.SupabaseClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The text game log is saved when a match ends, with the concede line appended. */
class MatchLogTest {

    private final UUID matchId = UUID.randomUUID();
    private SupabaseClient supabase;
    private MatchManager manager;
    private ForgeMatchSession session;

    @BeforeEach
    void setUp() {
        supabase = mock(SupabaseClient.class);
        manager = new MatchManager(supabase, mock(ForgeDeckConverter.class), mock(SimpMessagingTemplate.class),
                new FeatureFlags(false), mock(SupabaseStompAuthChannelInterceptor.class));
        session = mock(ForgeMatchSession.class);
    }

    @Test
    void savesForgesLogAsIs() {
        when(session.getLogText()).thenReturn("[Turn] Turn 1 (Aadi)\n[Life] Rehan lost 2 life\n");
        manager.saveLog(matchId, session, null);
        verify(supabase).saveMatchLog(matchId, "[Turn] Turn 1 (Aadi)\n[Life] Rehan lost 2 life\n");
    }

    @Test
    void appendsTheClosingLineOnConcede() {
        when(session.getLogText()).thenReturn("[Turn] Turn 1 (Aadi)\n");
        manager.saveLog(matchId, session, "Rehan conceded.");
        verify(supabase).saveMatchLog(matchId, "[Turn] Turn 1 (Aadi)\n[Game Outcome] Rehan conceded.\n");
    }

    @Test
    void aConcedeBeforeAnyLogStillLeavesALine() {
        when(session.getLogText()).thenReturn(null);
        manager.saveLog(matchId, session, "Rehan conceded.");
        verify(supabase).saveMatchLog(matchId, "[Game Outcome] Rehan conceded.\n");
    }

    @Test
    void nothingToSaveWritesNothing() {
        when(session.getLogText()).thenReturn(null);
        manager.saveLog(matchId, session, null);
        verify(supabase, never()).saveMatchLog(any(), any());
    }
}
