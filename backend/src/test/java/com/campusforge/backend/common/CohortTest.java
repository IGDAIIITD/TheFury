package com.campusforge.backend.common;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CohortTest {

    @Test
    void btechSpecializationsAreAllValid() {
        assertThat(Cohort.BTECH_SPECIALIZATIONS)
                .containsExactlyInAnyOrder("CSE", "CSAI", "CSAM", "CSB", "CSSS", "CSD", "CSECON", "ECE", "EVE");
        for (String spec : Cohort.BTECH_SPECIALIZATIONS) {
            assertThat(Cohort.isValid(Cohort.LEVEL_BTECH, spec)).isTrue();
        }
    }

    @Test
    void mtechSpecializationsAreValid() {
        assertThat(Cohort.MTECH_SPECIALIZATIONS).containsExactlyInAnyOrder("CSE", "ECE");
        assertThat(Cohort.isValid(Cohort.LEVEL_MTECH, "CSE")).isTrue();
        assertThat(Cohort.isValid(Cohort.LEVEL_MTECH, "ECE")).isTrue();
    }

    @Test
    void rejectsSpecializationsMismatchedWithDegreeLevel() {
        assertThat(Cohort.isValid(Cohort.LEVEL_MTECH, "CSAI")).isFalse();
        assertThat(Cohort.isValid(Cohort.LEVEL_BTECH, "CSAI")).isTrue();
        assertThat(Cohort.isValid("PHD", "CSE")).isFalse();
        assertThat(Cohort.isValid(null, "CSE")).isFalse();
        assertThat(Cohort.isValid(Cohort.LEVEL_BTECH, null)).isFalse();
        assertThat(Cohort.isValid(Cohort.LEVEL_BTECH, "CSAIX")).isFalse();
    }

    @Test
    void isCaseInsensitive() {
        assertThat(Cohort.isValid("btech", "csai")).isTrue();
        assertThat(Cohort.isValid("MTech", "ece")).isTrue();
    }

    @Test
    void departmentRollsUpSpecializations() {
        assertThat(Cohort.departmentOf("CSE")).isEqualTo("CSE");
        assertThat(Cohort.departmentOf("CSAI")).isEqualTo("CSE");
        assertThat(Cohort.departmentOf("CSECON")).isEqualTo("CSE");
        assertThat(Cohort.departmentOf("ECE")).isEqualTo("ECE");
        assertThat(Cohort.departmentOf("EVE")).isEqualTo("ECE");
        assertThat(Cohort.departmentOf(null)).isNull();
    }
}
