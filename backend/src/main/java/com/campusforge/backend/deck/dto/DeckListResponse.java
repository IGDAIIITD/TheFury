package com.campusforge.backend.deck.dto;

import java.util.List;

public record DeckListResponse(
        List<DeckDto> decks
) {
}
