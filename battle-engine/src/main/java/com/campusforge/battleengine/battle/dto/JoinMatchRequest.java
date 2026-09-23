package com.campusforge.battleengine.battle.dto;

import java.util.UUID;

public record JoinMatchRequest(
        String code,
        UUID deckId
) {
}