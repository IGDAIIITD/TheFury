package com.campusforge.backend.common.events;

import java.util.UUID;

/**
 * Published whenever a discovery actually unlocks a new card (or a UNIQUE card
 * is claimed). Consumed by the achievement and feed listeners.
 */
public record CardDiscoveredEvent(
        UUID playerId,
        String playerName,
        String cardForgeName,
        boolean unlocked,
        long experienceAwarded) {
}
