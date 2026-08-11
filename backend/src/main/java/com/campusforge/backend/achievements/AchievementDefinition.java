package com.campusforge.backend.achievements;

public record AchievementDefinition(
        String code,
        String name,
        String description,
        AchievementMetric metric,
        long threshold) {
}
