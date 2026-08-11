package com.campusforge.backend.accounts.dto;

import com.campusforge.backend.accounts.Player;

import java.util.UUID;

public record PlayerSummaryDto(
        UUID id,
        String displayName,
        String avatar,
        String studentId,
        String degreeLevel,
        String specialization
) {
    public static PlayerSummaryDto from(Player player) {
        return new PlayerSummaryDto(
                player.getId(),
                player.getDisplayName(),
                player.getAvatar(),
                player.getStudentId(),
                player.getDegreeLevel(),
                player.getSpecialization());
    }
}
