package com.campusforge.backend.collection.dto;

import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.OwnershipType;

import java.util.UUID;

public record CardDto(
        UUID id,
        String oracleId,
        String forgeName,
        String rarity,
        OwnershipType ownershipType,
        String setCode,
        Integer manaValue,
        String types,
        String colors,
        String imageUrl,
        boolean discoverable,
        String spawnRegion,
        Double weight,
        boolean commanderEligible
) {
    public static CardDto from(Card card) {
        return new CardDto(
                card.getId(),
                card.getOracleId(),
                card.getForgeName(),
                card.getRarity(),
                card.getOwnershipType(),
                card.getSetCode(),
                card.getManaValue(),
                card.getTypes(),
                card.getColors(),
                card.getImageUrl(),
                card.isDiscoverable(),
                card.getSpawnRegion(),
                card.getWeight(),
                card.isCommanderEligible());
    }
}
