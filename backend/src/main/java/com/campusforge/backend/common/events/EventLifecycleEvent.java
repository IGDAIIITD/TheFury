package com.campusforge.backend.common.events;

import java.math.BigDecimal;

/** Published when an admin creates or modifies an event whose window is live. */
public record EventLifecycleEvent(
        String eventName,
        boolean active,
        BigDecimal bonusMultiplier) {
}
