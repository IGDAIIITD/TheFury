package com.campusforge.backend.common.events;

/** Published when an admin spawns (mints) QR tokens for a card. */
public record SpawnEvent(
        String adminName,
        String cardForgeName,
        String building,
        int quantity) {
}
