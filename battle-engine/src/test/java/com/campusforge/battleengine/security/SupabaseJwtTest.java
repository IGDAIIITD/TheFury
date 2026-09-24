package com.campusforge.battleengine.security;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SupabaseJwtTest {

    // Unreachable JWKS endpoint: no asymmetric keys are loaded.
    private static final String NO_JWKS = "http://127.0.0.1:9";
    // The Supabase CLI's well-known local secret, i.e. public knowledge.
    private static final String CLI_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

    private static String hs256(String secret, UUID sub, long ttlMs) {
        return Jwts.builder()
                .subject(sub.toString())
                .claim("role", "authenticated")
                .expiration(new Date(System.currentTimeMillis() + ttlMs))
                .signWith(Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8)), Jwts.SIG.HS256)
                .compact();
    }

    @Test
    void rejectsSharedSecretTokensWhenNoSecretConfigured() {
        SupabaseJwt jwt = new SupabaseJwt(NO_JWKS, "");
        assertNull(jwt.parse(hs256(CLI_SECRET, UUID.randomUUID(), 60_000)));
    }

    @Test
    void acceptsSharedSecretTokensOnlyWithTheConfiguredSecret() {
        String secret = "a-project-specific-secret-that-is-long-enough";
        SupabaseJwt jwt = new SupabaseJwt(NO_JWKS, secret);
        UUID player = UUID.randomUUID();
        SupabaseJwt.BattleIdentity id = jwt.parse(hs256(secret, player, 60_000));
        assertNotNull(id);
        assertEquals(player, id.playerId());
        assertNull(jwt.parse(hs256(CLI_SECRET, player, 60_000)));
        assertNull(jwt.parse(hs256(secret, player, -60_000)), "expired tokens are rejected");
    }

    @Test
    void refusesShortSecrets() {
        assertThrows(IllegalStateException.class, () -> new SupabaseJwt(NO_JWKS, "short"));
    }
}
