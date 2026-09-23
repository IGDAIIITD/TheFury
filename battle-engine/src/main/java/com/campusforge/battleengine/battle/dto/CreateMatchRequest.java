package com.campusforge.battleengine.battle.dto;

import java.util.UUID;

public record CreateMatchRequest(
        UUID deckId,
        UUID opponentPlayerId,
        UUID opponentDeckId,
        UUID eventId
) {
}