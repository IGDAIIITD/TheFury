package com.campusforge.backend.accounts.dto;

import java.util.UUID;

public record AuthResponse(
        String token,
        String tokenType,
        PlayerResponse player
) {
    public static final String BEARER = "Bearer";

    public record PlayerResponse(
            UUID id,
            String email,
            String displayName,
            String role,
            String avatar,
            String studentId,
            String degreeLevel,
            String specialization,
            long experience,
            int level
    ) {
    }
}
