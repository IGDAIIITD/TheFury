package com.campusforge.backend.events.dto;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

public record UpdateEventRequest(
        String name,
        List<String> allowedSets,
        BigDecimal bonusMultiplier,
        LocalDateTime startTime,
        LocalDateTime endTime,
        Boolean active) {
}
