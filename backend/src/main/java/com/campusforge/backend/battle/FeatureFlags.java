package com.campusforge.backend.battle;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Feature switches surfaced to the web client so it can show/hide entry points.
 */
@Component
public class FeatureFlags {

    private final boolean aiBattlesEnabled;

    public FeatureFlags(@Value("${campusforge.features.ai-battles.enabled:false}") boolean aiBattlesEnabled) {
        this.aiBattlesEnabled = aiBattlesEnabled;
    }

    public boolean isAiBattlesEnabled() {
        return aiBattlesEnabled;
    }
}
