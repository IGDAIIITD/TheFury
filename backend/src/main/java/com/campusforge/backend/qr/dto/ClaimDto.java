package com.campusforge.backend.qr.dto;

import com.campusforge.backend.qr.Claim;
import com.campusforge.backend.qr.ClaimStatus;

import java.time.LocalDateTime;
import java.util.UUID;

public record ClaimDto(
        UUID id,
        String token,
        UUID cardId,
        String forgeName,
        String building,
        LocalDateTime expiresAt,
        ClaimStatus status,
        UUID eventId,
        String eventName,
        String spawnedBy,
        LocalDateTime createdAt
) {
    public static ClaimDto from(Claim claim) {
        return new ClaimDto(
                claim.getId(),
                claim.getToken(),
                claim.getCard().getId(),
                claim.getCard().getForgeName(),
                claim.getBuilding(),
                claim.getExpiresAt(),
                claim.getStatus(),
                claim.getEvent() != null ? claim.getEvent().getId() : null,
                claim.getEvent() != null ? claim.getEvent().getName() : null,
                claim.getSpawnedBy() != null ? claim.getSpawnedBy().getDisplayName() : null,
                claim.getCreatedAt());
    }
}
