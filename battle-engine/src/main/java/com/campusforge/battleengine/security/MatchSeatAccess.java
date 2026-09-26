package com.campusforge.battleengine.security;

import java.util.UUID;

/**
 * Who may watch a match seat topic ({@code /topic/match/{id}/p{index}}), and what happens when
 * they start watching. Implemented by the MatchManager; looked up lazily by the STOMP interceptor
 * (the manager itself depends on the interceptor).
 */
public interface MatchSeatAccess {

    /** True when {@code playerId} sits in seat {@code index} of the match. */
    boolean canWatchSeat(UUID matchId, int index, UUID playerId);

    /** A seat owner (re)subscribed: treat it as a reconnect. */
    void onSeatSubscribed(UUID matchId, UUID playerId);
}
