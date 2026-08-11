package com.campusforge.backend.qr;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class QrCodeSignerTest {

    private final QrCodeSigner signer = new QrCodeSigner("unit-test-secret");

    @Test
    void signProducesV1PayloadWithSignature() {
        String payload = signer.sign("ABC23456789X");
        String[] parts = payload.split("\\.");
        assertThat(parts).hasSize(3);
        assertThat(parts[0]).isEqualTo("V1");
        assertThat(parts[1]).isEqualTo("ABC23456789X");
        assertThat(parts[2]).hasSize(64).matches("[0-9A-F]+");
    }

    @Test
    void verifyRoundTripsTheCore() {
        assertThat(signer.verify(signer.sign("ABC23456789X"))).isEqualTo("ABC23456789X");
    }

    @Test
    void signIsDeterministicAndCaseNormalized() {
        assertThat(signer.sign("abc23456789x")).isEqualTo(signer.sign("ABC23456789X"));
        assertThat(signer.sign("ABC23456789X")).isEqualTo(signer.sign("abc23456789x"));
    }

    @Test
    void verifyAcceptsLowercasePayload() {
        assertThat(signer.verify(signer.sign("ABC23456789X").toLowerCase())).isEqualTo("ABC23456789X");
    }

    @Test
    void verifyRejectsTamperedSignature() {
        String payload = signer.sign("ABC23456789X");
        String tampered = payload.substring(0, payload.length() - 1) + "F";
        assertThat(signer.verify(tampered)).isNull();
    }

    @Test
    void verifyRejectsWrongCoreSignature() {
        String payload = signer.sign("ABC23456789X");
        String swapped = payload.replace("ABC23456789X", "XYZ23456789A");
        assertThat(signer.verify(swapped)).isNull();
    }

    @Test
    void verifyRejectsMalformedPayloads() {
        assertThat(signer.verify("")).isNull();
        assertThat(signer.verify("NOPE")).isNull();
        assertThat(signer.verify("V1.NOCORE")).isNull();
        assertThat(signer.verify("V2.ABC23456789X." + "A".repeat(64))).isNull();
        assertThat(signer.verify("V1.ABC23456789X.SHORT")).isNull();
    }

    @Test
    void differentSecretsProduceDifferentSignatures() {
        QrCodeSigner other = new QrCodeSigner("another-secret");
        assertThat(signer.sign("ABC23456789X")).isNotEqualTo(other.sign("ABC23456789X"));
    }
}
