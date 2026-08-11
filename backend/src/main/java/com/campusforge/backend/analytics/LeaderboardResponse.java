package com.campusforge.backend.analytics;

import java.util.List;
import java.util.UUID;

public record LeaderboardResponse(List<LeaderboardRowDto> rows, Integer myRank) {

    public record LeaderboardRowDto(
            int rank,
            UUID playerId,
            String displayName,
            String avatar,
            String degreeLevel,
            String specialization,
            int score,
            long value
    ) {
    }
}
