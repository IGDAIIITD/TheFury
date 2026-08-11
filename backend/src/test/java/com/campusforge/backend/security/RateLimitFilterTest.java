package com.campusforge.backend.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimitFilterTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private RateLimitFilter filter(int authCapacity, int claimCapacity) {
        return new RateLimitFilter(authCapacity, 1.0, claimCapacity, 1.0, MAPPER);
    }

    private MockHttpServletRequest request(String method, String path) {
        MockHttpServletRequest req = new MockHttpServletRequest(method, path);
        req.setRemoteAddr("127.0.0.1");
        return req;
    }

    private int countRejections(RateLimitFilter filter, MockHttpServletRequest request, int attempts) throws Exception {
        int rejected = 0;
        for (int i = 0; i < attempts; i++) {
            MockHttpServletResponse response = new MockHttpServletResponse();
            FilterChain chain = new MockFilterChain();
            filter.doFilter(request, response, chain);
            if (response.getStatus() == 429) {
                rejected++;
            }
        }
        return rejected;
    }

    @Test
    void limitsAuthEndpointPerIp() throws Exception {
        RateLimitFilter filter = filter(2, 10);
        MockHttpServletRequest req = request("POST", "/api/v1/auth/login");
        assertThat(countRejections(filter, req, 5)).isEqualTo(3);
    }

    @Test
    void limitsRegisterEndpointToo() throws Exception {
        RateLimitFilter filter = filter(1, 10);
        MockHttpServletRequest req = request("POST", "/api/v1/auth/register");
        assertThat(countRejections(filter, req, 3)).isEqualTo(2);
    }

    @Test
    void limitsClaimPerUserWhenAuthenticated() throws Exception {
        RateLimitFilter filter = filter(10, 2);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("a@b.c", null, java.util.List.of()));
        MockHttpServletRequest req = request("POST", "/api/v1/claim");
        assertThat(countRejections(filter, req, 5)).isEqualTo(3);
    }

    @Test
    void limitsClaimPerIpWhenAnonymous() throws Exception {
        RateLimitFilter filter = filter(10, 1);
        MockHttpServletRequest req = request("POST", "/api/v1/claim");
        assertThat(countRejections(filter, req, 3)).isEqualTo(2);
    }

    @Test
    void doesNotLimitNonTargetPaths() throws Exception {
        RateLimitFilter filter = filter(1, 1);
        MockHttpServletRequest req = request("GET", "/api/v1/events");
        assertThat(countRejections(filter, req, 3)).isZero();
    }

    @Test
    void rejectionsCarryRetryAfterHeader() throws Exception {
        RateLimitFilter filter = filter(1, 10);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request("POST", "/api/v1/auth/login"), response, new MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(200);
        filter.doFilter(request("POST", "/api/v1/auth/login"), response, new MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getHeader("Retry-After")).isNotNull();
        assertThat(response.getContentType()).contains("application/json");
    }
}
