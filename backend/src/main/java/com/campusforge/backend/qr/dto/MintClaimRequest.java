package com.campusforge.backend.qr.dto;

import com.campusforge.backend.qr.ClaimStatus;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDateTime;
import java.util.UUID;

public record MintClaimRequest(
        @NotNull(message = "cardId is required") UUID cardId,
        String building,
        LocalDateTime expiresAt,
        @Min(value = 1, message = "quantity must be at least 1") Integer quantity,
        UUID eventId
) {
    public int resolvedQuantity() {
        return quantity == null ? 1 : quantity;
    }
}
