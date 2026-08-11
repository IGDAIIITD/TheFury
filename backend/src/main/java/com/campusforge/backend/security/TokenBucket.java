package com.campusforge.backend.security;

import java.time.Instant;

/**
 * A fixed-capacity token bucket with a per-second refill rate, used by
 * {@link RateLimitFilter}. Thread-safe: refill and consume are atomic on the
 * bucket instance.
 */
public class TokenBucket {

    private final int capacity;
    private final double refillPerSecond;

    private volatile double tokens;
    private volatile long lastRefillNanos;

    public TokenBucket(int capacity, double refillPerSecond) {
        if (capacity <= 0 || refillPerSecond <= 0) {
            throw new IllegalArgumentException("capacity and refill rate must be positive");
        }
        this.capacity = capacity;
        this.refillPerSecond = refillPerSecond;
        this.tokens = capacity;
        this.lastRefillNanos = System.nanoTime();
    }

    /** Refills to current capacity, then consumes one token if available. */
    public synchronized boolean tryConsume() {
        long now = System.nanoTime();
        double elapsed = (now - lastRefillNanos) / 1_000_000_000.0;
        if (elapsed > 0) {
            tokens = Math.min(capacity, tokens + elapsed * refillPerSecond);
            lastRefillNanos = now;
        }
        if (tokens >= 1.0) {
            tokens -= 1.0;
            return true;
        }
        return false;
    }

    /** Seconds until at least one token is available again (for Retry-After). */
    public int secondsUntilRefill() {
        double missing = Math.max(0.0, 1.0 - tokens);
        return (int) Math.ceil(missing / refillPerSecond);
    }

    /** Visible for tests. */
    Instant lastRefill() {
        return Instant.ofEpochSecond(0, lastRefillNanos);
    }
}
