package com.campusforge.backend.collection.dto;

import java.util.List;

public record CollectionResponse(
        List<CollectionEntryDto> entries,
        long totalCards
) {
}
