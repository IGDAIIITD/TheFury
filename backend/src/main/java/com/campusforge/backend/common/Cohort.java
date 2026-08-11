package com.campusforge.backend.common;

import java.util.Set;

/**
 * Degree programs ("cohorts") used for player affiliation and leaderboard filtering.
 * B.Tech students pick a specialization; M.Tech students a department.
 * Departments roll up: CSE group and ECE group (including EVE).
 */
public final class Cohort {

    public static final String LEVEL_BTECH = "BTECH";
    public static final String LEVEL_MTECH = "MTECH";

    public static final Set<String> BTECH_SPECIALIZATIONS = Set.of(
            "CSE", "CSAI", "CSAM", "CSB", "CSSS", "CSD", "CSECON", "ECE", "EVE");

    public static final Set<String> MTECH_SPECIALIZATIONS = Set.of("CSE", "ECE");

    public static final String DEPARTMENT_CSE = "CSE";
    public static final String DEPARTMENT_ECE = "ECE";

    private Cohort() {
    }

    /** True when the specialization is legal for the given degree level. */
    public static boolean isValid(String degreeLevel, String specialization) {
        if (degreeLevel == null || specialization == null) {
            return false;
        }
        return switch (degreeLevel.toUpperCase()) {
            case LEVEL_BTECH -> BTECH_SPECIALIZATIONS.contains(specialization.toUpperCase());
            case LEVEL_MTECH -> MTECH_SPECIALIZATIONS.contains(specialization.toUpperCase());
            default -> false;
        };
    }

    /** Rolls a specialization up to its department (CSE or ECE). Null-safe. */
    public static String departmentOf(String specialization) {
        if (specialization == null) {
            return null;
        }
        return switch (specialization.toUpperCase()) {
            case "ECE", "EVE" -> DEPARTMENT_ECE;
            default -> DEPARTMENT_CSE;
        };
    }
}
