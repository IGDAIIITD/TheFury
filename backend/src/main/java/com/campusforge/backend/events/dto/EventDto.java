package com.campusforge.backend.events.dto;

import com.campusforge.backend.events.Event;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public record EventDto(
        UUID id,
        String name,
        List<String> allowedSets,
        BigDecimal bonusMultiplier,
        LocalDateTime startTime,
        LocalDateTime endTime,
        boolean active,
        LocalDateTime createdAt) {

    public static EventDto from(Event event) {
        return new EventDto(
                event.getId(),
                event.getName(),
                event.getAllowedSets(),
                event.getBonusMultiplier(),
                event.getStartTime(),
                event.getEndTime(),
                event.isActive(),
                event.getCreatedAt());
    }
}
