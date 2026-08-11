package com.campusforge.backend.feed;

import java.time.LocalDateTime;

public record FeedEntryDto(
        String type,
        String message,
        String playerName,
        LocalDateTime createdAt) {
}
