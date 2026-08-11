package com.campusforge.backend.common;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class LevelServiceTest {

    @Test
    void startsAtLevelOne() {
        assertThat(LevelService.levelFor(0)).isEqualTo(1);
        assertThat(LevelService.levelFor(99)).isEqualTo(1);
    }

    @Test
    void rollsOverEveryHundredExperience() {
        assertThat(LevelService.levelFor(100)).isEqualTo(2);
        assertThat(LevelService.levelFor(1210)).isEqualTo(13);
        assertThat(LevelService.levelFor(50_000)).isEqualTo(501);
    }
}
