package com.campusforge.backend.trade.dto;

import com.campusforge.backend.collection.UniqueCard;
import com.campusforge.backend.trade.TradeSide;

import java.util.UUID;

public record TradeCardDto(
        UUID physicalUuid,
        UUID cardId,
        String forgeName,
        String setCode,
        String rarity,
        String imageUrl,
        int serialNumber
) {
    public static TradeCardDto from(TradeSide side, UniqueCard card) {
        return new TradeCardDto(
                card.getPhysicalUuid(),
                card.getCard().getId(),
                card.getCard().getForgeName(),
                card.getCard().getSetCode(),
                card.getCard().getRarity(),
                card.getCard().getImageUrl(),
                card.getSerialNumber());
    }
}
