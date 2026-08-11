package com.campusforge.backend.deck.dto;

import java.util.UUID;

public record DeckProblemDto(
        String code,
        String message,
        UUID cardId
) {
}
