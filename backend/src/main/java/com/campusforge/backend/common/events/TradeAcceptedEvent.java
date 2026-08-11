package com.campusforge.backend.common.events;

import java.util.UUID;

/** Published when a unique-card trade is accepted and ownership has swapped. */
public record TradeAcceptedEvent(
        UUID senderId,
        String senderName,
        UUID receiverId,
        String receiverName) {
}
