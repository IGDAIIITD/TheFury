package com.campusforge.battleengine.battle.dto;

import java.util.UUID;

public record CreateLobbyRequest(
        UUID deckId,
        UUID eventId
) {
}