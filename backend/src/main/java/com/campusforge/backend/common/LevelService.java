package com.campusforge.backend.common;

/**
 * Single source of truth for the level formula: level = 1 + floor(experience / 100).
 */
public final class LevelService {

    public static final int XP_PER_LEVEL = 100;

    private LevelService() {
    }

    public static int levelFor(long experience) {
        return 1 + (int) (experience / XP_PER_LEVEL);
    }
}
