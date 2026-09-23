package com.campusforge.battleengine;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Standalone battle engine: owns in-memory Forge match state, validates decks
 * and writes match results through Supabase service-role RPCs, and authenticates
 * players with Supabase Auth access-token JWTs.
 */
@SpringBootApplication
public class BattleEngineApplication {

    public static void main(String[] args) {
        SpringApplication.run(BattleEngineApplication.class, args);
    }
}