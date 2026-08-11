package com.campusforge.backend.security;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TokenBucketTest {

    @Test
    void allowsUpToCapacityInABurst() {
        TokenBucket bucket = new TokenBucket(3, 1.0);
        assertThat(bucket.tryConsume()).isTrue();
        assertThat(bucket.tryConsume()).isTrue();
        assertThat(bucket.tryConsume()).isTrue();
        assertThat(bucket.tryConsume()).isFalse();
    }

    @Test
    void rejectsPositiveCapacityRequirement() {
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> new TokenBucket(0, 1.0));
    }
}
