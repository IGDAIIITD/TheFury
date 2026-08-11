package com.campusforge.backend.battle.dto;

import java.util.UUID;

public record CreateLobbyRequest(
        UUID deckId,
        UUID eventId
) {
}
