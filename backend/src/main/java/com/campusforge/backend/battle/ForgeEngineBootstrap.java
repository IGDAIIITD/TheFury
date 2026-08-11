package com.campusforge.backend.battle;

import forge.headless.ForgeBootstrap;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Initializes the embedded Forge engine (card database, localizer, image keys)
 * once when the backend starts. Uses the shared Forge resource dir, configured
 * via the {@code forge.res.dir} system property or resolved relative to the
 * backend working directory.
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
