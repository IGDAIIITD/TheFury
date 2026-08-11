package com.campusforge.backend.deck;

import com.campusforge.backend.deck.dto.DeckProblemDto;

import java.util.List;

public class InvalidDeckException extends RuntimeException {

    private final List<DeckProblemDto> problems;

    public InvalidDeckException(List<DeckProblemDto> problems) {
        super("Deck is invalid");
        this.problems = problems;
    }

    public List<DeckProblemDto> getProblems() {
        return problems;
    }
}
