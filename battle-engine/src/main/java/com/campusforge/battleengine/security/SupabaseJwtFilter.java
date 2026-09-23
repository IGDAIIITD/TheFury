package com.campusforge.battleengine.security;

import com.campusforge.battleengine.security.SupabaseJwt.BattleIdentity;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * Authenticates REST requests against Supabase access-token JWTs in the
 * {@code Authorization: Bearer} header (replaces the backend's own JWT filter).
 */
@Component
public class SupabaseJwtFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(SupabaseJwtFilter.class);
    private static final String BEARER_PREFIX = "Bearer ";

    private final SupabaseJwt supabaseJwt;

    public SupabaseJwtFilter(SupabaseJwt supabaseJwt) {
        this.supabaseJwt = supabaseJwt;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            String token = header.substring(BEARER_PREFIX.length());
            BattleIdentity identity = supabaseJwt.parse(token);
            if (identity != null) {
                UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                        identity, null, List.of());
                SecurityContextHolder.getContext().setAuthentication(auth);
            } else {
                log.debug("Rejected invalid Supabase JWT on {}", request.getRequestURI());
            }
        }
        chain.doFilter(request, response);
    }
}