package com.campusforge.battleengine.battle;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

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