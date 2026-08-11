package com.campusforge.backend.deck.dto;

import com.campusforge.backend.collection.Card;

import java.util.UUID;

public record DeckCardDto(
        UUID cardId,
        String forgeName,
        int quantity
) {
    public static DeckCardDto from(Card card, int quantity) {
        return new DeckCardDto(card.getId(), card.getForgeName(), quantity);
    }
}
