package com.campusforge.backend.deck.dto;

import com.campusforge.backend.collection.Card;
import com.campusforge.backend.deck.Deck;
import com.campusforge.backend.deck.DeckCard;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public record DeckDto(
        UUID id,
        String name,
        String formatCode,
        UUID commanderCardId,
        List<DeckCardDto> cards,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public static DeckDto from(Deck deck) {
        UUID commanderId = deck.getCommander() != null ? deck.getCommander().getId() : null;
        List<DeckCardDto> cardDtos = deck.getCards().stream()
                .sorted((a, b) -> a.getCard().getForgeName().compareToIgnoreCase(b.getCard().getForgeName()))
                .map(dc -> DeckCardDto.from(dc.getCard(), dc.getQuantity()))
                .toList();
        return new DeckDto(deck.getId(), deck.getName(), deck.getFormatCode(), commanderId,
                cardDtos, deck.getCreatedAt(), deck.getUpdatedAt());
    }
}
