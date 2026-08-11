package com.campusforge.backend.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * In-memory rate limiter for the claim and authentication endpoints. Auth
 * endpoints are throttled per client IP; the claim endpoint per authenticated
 * user (falling back to IP when no authentication is present).
 *
 * <p>Buckets are kept in a bounded concurrent map keyed by {@code scope:identity}.
 * This is a single-instance limiter — a multi-node deployment should back it
 * with a shared store instead.</p>
 */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private final int authCapacity;
    private final double authRefillPerSecond;
    private final int claimCapacity;
    private final double claimRefillPerSecond;
    private final ObjectMapper objectMapper;
    private final ConcurrentMap<String, TokenBucket> buckets = new ConcurrentHashMap<>();

    public RateLimitFilter(
            @Value("${campusforge.security.rate-limit.auth.capacity:20}") int authCapacity,
            @Value("${campusforge.security.rate-limit.auth.refill-per-sec:1.0}") double authRefillPerSecond,
            @Value("${campusforge.security.rate-limit.claim.capacity:30}") int claimCapacity,
            @Value("${campusforge.security.rate-limit.claim.refill-per-sec:2.0}") double claimRefillPerSecond,
            ObjectMapper objectMapper) {
        this.authCapacity = authCapacity;
        this.authRefillPerSecond = authRefillPerSecond;
        this.claimCapacity = claimCapacity;
        this.claimRefillPerSecond = claimRefillPerSecond;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String scope = scopeFor(request);
        if (scope == null) {
            filterChain.doFilter(request, response);
            return;
        }

        String key = scope + ":" + identityFor(request);
        TokenBucket bucket = buckets.computeIfAbsent(key, k -> newBucket(scope));
        if (!bucket.tryConsume()) {
            response.setStatus(429);
            response.setHeader("Retry-After", String.valueOf(bucket.secondsUntilRefill()));
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            objectMapper.writeValue(response.getWriter(), Map.of("error", "Too Many Requests"));
            return;
        }

        filterChain.doFilter(request, response);
    }

    /** Returns the rate-limit scope for the request, or null if not limited. */
    private String scopeFor(HttpServletRequest request) {
        String method = request.getMethod();
        if (!HttpMethod.POST.matches(method)) {
            return null;
        }
        String path = request.getRequestURI();
        if (path.endsWith("/api/v1/auth/login") || path.endsWith("/api/v1/auth/register")) {
            return "auth";
        }
        if (path.endsWith("/api/v1/claim")) {
            return "claim";
        }
        return null;
    }

    private String identityFor(HttpServletRequest request) {
        if ("claim".equals(scopeFor(request))) {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getPrincipal())) {
                String name = auth.getName();
                if (name != null && !name.isBlank()) {
                    return "user:" + name;
                }
            }
        }
        String ip = request.getRemoteAddr();
        return "ip:" + (ip == null ? "unknown" : ip);
    }

    private TokenBucket newBucket(String scope) {
        if ("auth".equals(scope)) {
            return new TokenBucket(authCapacity, authRefillPerSecond);
        }
        return new TokenBucket(claimCapacity, claimRefillPerSecond);
    }
}
