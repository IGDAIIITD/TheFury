package com.campusforge.battleengine.config;

import forge.headless.ForgeBootstrap;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Initializes the embedded Forge engine (card database, localizer, image keys)
 * once when the battle engine starts. Card data resolves relative to the working
 * directory (run from {@code battle-engine/}) or via {@code forge.res.dir}.
 */
@Component
public class ForgeEngineBootstrap {

    private static final Logger log = LoggerFactory.getLogger(ForgeEngineBootstrap.class);

    @PostConstruct
    public void init() {
        long start = System.currentTimeMillis();
        ForgeBootstrap.init();
        log.info("Forge engine ready in {} ms", System.currentTimeMillis() - start);
    }
}