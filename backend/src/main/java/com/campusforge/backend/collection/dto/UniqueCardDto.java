package com.campusforge.backend.collection.dto;

import com.campusforge.backend.collection.UniqueCard;

import java.time.LocalDateTime;
import java.util.UUID;

public record UniqueCardDto(
        UUID physicalUuid,
        UUID cardId,
        String forgeName,
        String setCode,
        String rarity,
        String imageUrl,
        int serialNumber,
        LocalDateTime claimedAt,
        String history
) {
    public static UniqueCardDto from(UniqueCard card) {
        return new UniqueCardDto(
                card.getPhysicalUuid(),
                card.getCard().getId(),
                card.getCard().getForgeName(),
                card.getCard().getSetCode(),
                card.getCard().getRarity(),
                card.getCard().getImageUrl(),
                card.getSerialNumber(),
                card.getClaimedAt(),
                card.getHistory());
    }
}
