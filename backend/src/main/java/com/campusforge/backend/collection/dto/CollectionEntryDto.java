package com.campusforge.backend.collection.dto;

import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.OwnershipType;

import java.util.UUID;

public record CollectionEntryDto(
        UUID cardId,
        String forgeName,
        OwnershipType ownershipType,
        long quantity,
        long discoveredCount,
        boolean favorite
) {
    public static CollectionEntryDto from(Card card, long quantity, long discoveredCount, boolean favorite) {
        return new CollectionEntryDto(
                card.getId(),
                card.getForgeName(),
                card.getOwnershipType(),
                quantity,
                discoveredCount,
                favorite);
    }
}
