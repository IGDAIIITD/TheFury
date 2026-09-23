package com.campusforge.battleengine.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.ProtectedHeader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.KeyFactory;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Validates Supabase Auth access-token JWTs. Access tokens are signed with the
 * project's signing key published via JWKS ({@code /auth/v1/.well-known/jwks.json}),
 * so verification uses a key locator keyed by {@code kid}. A HS256 shared-secret
 * fallback is kept for local/demo setups that sign tokens with GOTRUE_JWT_SECRET.
 */
@Component
public class SupabaseJwt {

    private static final Logger log = LoggerFactory.getLogger(SupabaseJwt.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public record BattleIdentity(UUID playerId, String role) {
    }

    private final String jwksUrl;
    private final String hsSecret;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final AtomicReference<Map<String, Key>> jwks = new AtomicReference<>(Map.of());

    public SupabaseJwt(@Value("${supabase.url}") String baseUrl,
                       @Value("${supabase.jwt-secret}") String jwtSecret) {
        String b = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.jwksUrl = b + "/auth/v1/.well-known/jwks.json";
        this.hsSecret = jwtSecret;
        refreshJwks();
    }

    private void refreshJwks() {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(jwksUrl))
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            HttpResponse<byte[]> res = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (res.statusCode() != 200) {
                log.warn("JWKS fetch {} -> {}", jwksUrl, res.statusCode());
                return;
            }
            JsonNode root = MAPPER.readTree(res.body());
            Map<String, Key> keys = new HashMap<>();
            for (JsonNode jwk : root.path("keys")) {
                String kid = jwk.path("kid").asText();
                String kty = jwk.path("kty").asText();
                if ("RSA".equals(kty)) {
                    Key key = rsaKey(jwk);
                    if (key != null) {
                        keys.put(kid, key);
                    }
                } else if ("EC".equals(kty)) {
                    Key key = ecKey(jwk);
                    if (key != null) {
                        keys.put(kid, key);
                    }
                } else if ("oct".equals(kty)) {
                    String k = jwk.path("k").asText();
                    if (!k.isBlank()) {
                        keys.put(kid, new SecretKeySpec(base64url(k), "HmacSHA256"));
                    }
                }
            }
            jwks.set(keys);
            log.info("Loaded {} JWKS keys from {}", keys.size(), jwksUrl);
        } catch (Exception e) {
            log.warn("Failed to load JWKS from {}: {}", jwksUrl, e.getMessage());
        }
    }

    private Key ecKey(JsonNode jwk) {
        try {
            String crv = jwk.path("crv").asText();
            byte[] xb = base64url(jwk.path("x").asText());
            byte[] yb = base64url(jwk.path("y").asText());
            if (xb.length == 0 || yb.length == 0) {
                return null;
            }
            javax.security.auth.x500.X500Principal p = new javax.security.auth.x500.X500Principal("CN=ec");
            java.security.spec.AlgorithmParameterSpec params;
            if ("P-256".equals(crv)) {
                java.security.spec.ECGenParameterSpec spec = new java.security.spec.ECGenParameterSpec("secp256r1");
                java.security.AlgorithmParameters ap = java.security.AlgorithmParameters.getInstance("EC");
                ap.init(spec);
                params = ap.getParameterSpec(ECParameterSpec.class);
            } else if ("P-384".equals(crv)) {
                java.security.spec.ECGenParameterSpec spec = new java.security.spec.ECGenParameterSpec("secp384r1");
                java.security.AlgorithmParameters ap = java.security.AlgorithmParameters.getInstance("EC");
                ap.init(spec);
                params = ap.getParameterSpec(ECParameterSpec.class);
            } else {
                return null;
            }
            ECPoint point = new ECPoint(new java.math.BigInteger(1, xb), new java.math.BigInteger(1, yb));
            ECPublicKeySpec keySpec = new ECPublicKeySpec(point, (ECParameterSpec) params);
            return KeyFactory.getInstance("EC").generatePublic(keySpec);
        } catch (Exception e) {
            log.warn("Failed to build EC key: {}", e.getMessage());
            return null;
        }
    }

    private Key rsaKey(JsonNode jwk) {
        try {
            byte[] n = base64url(jwk.path("n").asText());
            byte[] e = base64url(jwk.path("e").asText());
            java.security.spec.RSAPublicKeySpec spec = new java.security.spec.RSAPublicKeySpec(
                    new java.math.BigInteger(1, n), new java.math.BigInteger(1, e));
            return KeyFactory.getInstance("RSA").generatePublic(spec);
        } catch (Exception ex) {
            log.warn("Failed to build RSA key: {}", ex.getMessage());
            return null;
        }
    }

    private static byte[] base64url(String s) {
        return Base64.getUrlDecoder().decode(s);
    }

    /** Parses and validates a token, returning the identity or null when invalid. */
    public BattleIdentity parse(String token) {
        try {
            Claims claims = Jwts.parser()
                    .keyLocator(this::locate)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            String sub = claims.getSubject();
            if (sub == null || sub.isBlank()) {
                return null;
            }
            UUID playerId;
            try {
                playerId = UUID.fromString(sub);
            } catch (IllegalArgumentException e) {
                return null;
            }
            String role = claims.get("role", String.class);
            return new BattleIdentity(playerId, role != null ? role : "authenticated");
        } catch (JwtException | IllegalArgumentException e) {
            return null;
        }
    }

    private Key locate(io.jsonwebtoken.Header header) {
        Map<String, Key> keys = jwks.get();
        String kid = header != null ? (String) header.get("kid") : null;
        if (kid != null && keys.containsKey(kid)) {
            return keys.get(kid);
        }
        // fall back to the shared-secret key for HS256 local/demo tokens
        SecretKey hsKey = new SecretKeySpec(hsSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        return hsKey;
    }
}