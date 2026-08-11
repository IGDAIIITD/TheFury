package com.campusforge.backend.deck.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record DeckCardRequest(
        @NotNull UUID cardId,
        @Min(1) int quantity
) {
}
