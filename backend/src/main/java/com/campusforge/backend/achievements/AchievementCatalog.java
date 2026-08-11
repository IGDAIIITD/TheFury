package com.campusforge.backend.achievements;

import java.util.List;
import java.util.Optional;

/**
 * Single source of truth for achievement definitions. The stored
 * {@code player_achievements} rows are unlocked through {@link AchievementService}
 * by comparing each definition's metric against a player's current progress.
 */
public final class AchievementCatalog {

    private AchievementCatalog() {
    }

    public static final List<AchievementDefinition> ALL = List.of(
            new AchievementDefinition("FIRST_DISCOVERY", "First Discovery", "Discover your first card.", AchievementMetric.DISCOVERIES, 1),
            new AchievementDefinition("EXPLORER", "Explorer", "Discover 25 cards.", AchievementMetric.DISCOVERIES, 25),
            new AchievementDefinition("COLLECTOR_I", "Collector I", "Own 25% of the card catalog.", AchievementMetric.COLLECTION_PCT, 25),
            new AchievementDefinition("COLLECTOR_II", "Collector II", "Own 50% of the card catalog.", AchievementMetric.COLLECTION_PCT, 50),
            new AchievementDefinition("COLLECTOR_III", "Collector III", "Own 75% of the card catalog.", AchievementMetric.COLLECTION_PCT, 75),
            new AchievementDefinition("COMPLETIONIST", "Completionist", "Own every card.", AchievementMetric.COLLECTION_PCT, 100),
            new AchievementDefinition("BATTLE_VETERAN", "Battle Veteran", "Win your first battle.", AchievementMetric.BATTLES_WON, 1),
            new AchievementDefinition("UNDEFEATED", "Undefeated", "Win every battle you finish.", AchievementMetric.UNDEFEATED, 1),
            new AchievementDefinition("RISING_STAR", "Rising Star", "Reach level 5.", AchievementMetric.LEVEL, 5),
            new AchievementDefinition("HALL_OF_FAME", "Hall of Fame", "Reach level 10.", AchievementMetric.LEVEL, 10),
            new AchievementDefinition("FIRST_TRADE", "First Trade", "Complete your first unique-card trade.", AchievementMetric.UNIQUE_TRADES, 1),
            new AchievementDefinition("MASTER_TRADER", "Master Trader", "Complete 5 unique-card trades.", AchievementMetric.UNIQUE_TRADES, 5)
    );

    public static Optional<AchievementDefinition> byCode(String code) {
        return ALL.stream().filter(a -> a.code().equals(code)).findFirst();
    }
}
