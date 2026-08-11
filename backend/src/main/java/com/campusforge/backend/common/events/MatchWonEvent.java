package com.campusforge.backend.common.events;

import java.util.UUID;

/** Published after a match finishes and the winner is awarded XP. */
public record MatchWonEvent(
        UUID playerId,
        String playerName,
        long xpAwarded) {
}
