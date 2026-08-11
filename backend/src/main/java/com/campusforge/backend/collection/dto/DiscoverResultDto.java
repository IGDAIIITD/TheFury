package com.campusforge.backend.collection.dto;

import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.OwnershipType;

public record DiscoverResultDto(
        CardDto card,
        boolean unlocked,
        boolean alreadyOwned,
        long discoveryCount,
        long experienceAwarded
) {
    public static DiscoverResultDto unlocked(Card card, long discoveryCount, long experienceAwarded) {
        return new DiscoverResultDto(CardDto.from(card), true, false, discoveryCount, experienceAwarded);
    }

    public static DiscoverResultDto alreadyOwned(Card card, long discoveryCount) {
        return new DiscoverResultDto(CardDto.from(card), false, true, discoveryCount, 0);
    }
}
