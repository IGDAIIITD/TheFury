package com.campusforge.backend.analytics;

import com.campusforge.backend.accounts.dto.AuthResponse;

import java.util.List;

public record ProfileStatsDto(
        AuthResponse.PlayerResponse player,
        long experience,
        int level,
        long experienceToNextLevel,
        int collectionCompletionPercent,
        long ownedCards,
        long totalCards,
        long totalDiscoveries,
        List<String> favoriteColors,
        List<String> buildingsVisited,
        BattleStatsDto battleStats,
        List<BadgeDto> badges
) {
    public record BattleStatsDto(int played, int wins, int losses, int winRatePercent) {
    }

    public record BadgeDto(String code, String name, String description) {
    }
}
