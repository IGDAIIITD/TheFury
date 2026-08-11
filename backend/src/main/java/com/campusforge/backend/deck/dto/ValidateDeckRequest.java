package com.campusforge.backend.deck.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;
import java.util.UUID;

public record ValidateDeckRequest(
        @NotBlank String formatCode,
        UUID commanderCardId,
        @NotEmpty @Valid List<DeckCardRequest> cards
) {
}
