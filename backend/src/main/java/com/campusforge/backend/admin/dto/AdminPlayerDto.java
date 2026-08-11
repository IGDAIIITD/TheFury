package com.campusforge.backend.admin.dto;

import com.campusforge.backend.accounts.Player;

import java.time.LocalDateTime;
import java.util.UUID;

public record AdminPlayerDto(
        UUID id,
        String email,
        String displayName,
        String role,
        String studentId,
        String degreeLevel,
        String specialization,
        long experience,
        int level,
        boolean banned,
        LocalDateTime bannedAt,
        LocalDateTime created,
        LocalDateTime lastLogin) {

    public static AdminPlayerDto from(Player player) {
        return new AdminPlayerDto(
                player.getId(),
                player.getEmail(),
                player.getDisplayName(),
                player.getRole(),
                player.getStudentId(),
                player.getDegreeLevel(),
                player.getSpecialization(),
                player.getExperience(),
                player.getLevel(),
                player.isBanned(),
                player.getBannedAt(),
                player.getCreated(),
                player.getLastLogin());
    }
}
