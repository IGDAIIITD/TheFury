package com.campusforge.backend.deck;

import java.util.UUID;

public record DeckProblem(
        String code,
        String message,
        UUID cardId
) {
    public static DeckProblem of(String code, String message) {
        return new DeckProblem(code, message, null);
    }

    public static DeckProblem of(String code, String message, UUID cardId) {
        return new DeckProblem(code, message, cardId);
    }
}
