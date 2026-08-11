package com.campusforge.backend.deck.dto;

import java.util.List;

public record DeckValidationResult(
        boolean valid,
        List<DeckProblemDto> problems
) {
    public static DeckValidationResult ok() {
        return new DeckValidationResult(true, List.of());
    }

    public static DeckValidationResult invalid(List<DeckProblemDto> problems) {
        return new DeckValidationResult(false, problems);
    }
}
