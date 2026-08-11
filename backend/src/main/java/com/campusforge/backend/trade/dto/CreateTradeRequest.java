package com.campusforge.backend.trade.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.UUID;

public record CreateTradeRequest(
        @NotNull(message = "receiverId is required") UUID receiverId,
        @NotEmpty(message = "offered cards cannot be empty") List<UUID> offeredPhysicalUuids,
        @NotEmpty(message = "requested cards cannot be empty") List<UUID> requestedPhysicalUuids
) {
}
