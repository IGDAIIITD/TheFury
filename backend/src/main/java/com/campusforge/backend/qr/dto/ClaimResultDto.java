package com.campusforge.backend.qr.dto;

import com.campusforge.backend.collection.dto.CardDto;
import com.campusforge.backend.collection.dto.DiscoverResultDto;

public record ClaimResultDto(
        CardDto card,
        boolean unlocked,
        boolean alreadyOwned,
        long discoveryCount,
        long experienceAwarded,
        String token,
        String building
) {
    public static ClaimResultDto from(DiscoverResultDto dto, String token, String building) {
        return new ClaimResultDto(
                dto.card(), dto.unlocked(), dto.alreadyOwned(),
                dto.discoveryCount(), dto.experienceAwarded(), token, building);
    }
}
