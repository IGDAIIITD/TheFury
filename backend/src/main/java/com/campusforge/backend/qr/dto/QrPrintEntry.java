package com.campusforge.backend.qr.dto;

public record QrPrintEntry(
        String cardName,
        String oracleId,
        String tokenCore,
        String fullToken,
        String ownershipType,
        String rarity
) {}
