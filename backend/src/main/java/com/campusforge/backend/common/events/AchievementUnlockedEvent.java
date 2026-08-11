package com.campusforge.backend.common.events;

import java.util.List;
import java.util.UUID;

/** Published when one or more achievements are newly unlocked for a player. */
public record AchievementUnlockedEvent(
        UUID playerId,
        String playerName,
        List<AchievementUnlockedItem> achievements) {

    public record AchievementUnlockedItem(String code, String name) {
    }
}
