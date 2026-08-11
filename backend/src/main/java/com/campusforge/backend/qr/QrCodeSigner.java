package com.campusforge.backend.qr;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/**
 * HMAC-SHA256 signer for claim tokens. A public claim token is a signed payload
 * of the form {@code V1.<CORE>.<SIG>} where CORE is the 12-char token drawn from
 * {@code ClaimService.TOKEN_ALPHABET} and SIG is an uppercase hex HMAC over
 * {@code V1.<CORE>} computed with the {@code campusforge.qr.signing-secret}.
 *
 * <p>The core stays the stable, unique identifier persisted in
 * {@code claims.token_core}; the signature lets the claim endpoint reject
 * forged or mangled codes before any database lookup.
 */
@Component
public class QrCodeSigner {

    private static final String VERSION = "V1";
    private static final String HMAC_ALGO = "HmacSHA256";

    private final byte[] secret;

    public QrCodeSigner(@Value("${campusforge.qr.signing-secret}") String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    public String sign(String core) {
        String normalized = normalize(core);
        return VERSION + "." + normalized + "." + hex(hmac(VERSION + "." + normalized));
    }

    /**
     * Returns the embedded core if {@code payload} is a well-formed signed token
     * carrying a valid signature, otherwise {@code null}.
     */
    public String verify(String payload) {
        String normalized = normalize(payload);
        String[] parts = normalized.split("\\.");
        if (parts.length != 3 || !VERSION.equals(parts[0]) || parts[1].isEmpty() || parts[2].isEmpty()) {
            return null;
        }
        byte[] expected = hex(hmac(VERSION + "." + parts[1])).getBytes(StandardCharsets.US_ASCII);
        byte[] actual = parts[2].getBytes(StandardCharsets.US_ASCII);
        if (!MessageDigest.isEqual(expected, actual)) {
            return null;
        }
        return parts[1];
    }

    private static String normalize(String value) {
        return value.trim().toUpperCase();
    }

    private byte[] hmac(String data) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGO);
            mac.init(new SecretKeySpec(secret, HMAC_ALGO));
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC signing failed", e);
        }
    }

    private static String hex(byte[] bytes) {
        return HexFormat.of().withUpperCase().formatHex(bytes);
    }
}
