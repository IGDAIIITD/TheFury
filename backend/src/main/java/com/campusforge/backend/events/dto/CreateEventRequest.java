package com.campusforge.backend.events.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

public record CreateEventRequest(
        @NotBlank(message = "name is required") String name,
        List<String> allowedSets,
        BigDecimal bonusMultiplier,
        @NotNull(message = "startTime is required") LocalDateTime startTime,
        @NotNull(message = "endTime is required") LocalDateTime endTime) {
}
