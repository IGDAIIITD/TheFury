package com.campusforge.battleengine.config;

import com.campusforge.battleengine.security.SupabaseJwtFilter;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * REST security for the battle engine: stateless, Bearer-only. WS CONNECT auth
 * is handled by the STOMP channel interceptor, not this chain. {@code /ws/**} and
 * {@code /error} are open so the WS handshake and error dispatches aren't
 * rewritten to 401.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final SupabaseJwtFilter supabaseJwtFilter;

    public SecurityConfig(SupabaseJwtFilter supabaseJwtFilter) {
        this.supabaseJwtFilter = supabaseJwtFilter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(AbstractHttpConfigurer::disable)
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(eh -> eh.authenticationEntryPoint((req, res, ex) -> {
                    res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                    res.setContentType("application/json");
                    res.getWriter().write("{\"code\":\"UNAUTHORIZED\",\"message\":\"Missing or invalid credentials\"}");
                }))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/ws/**", "/error").permitAll()
                        .requestMatchers("/api/v1/battle/features").permitAll()
                        .anyRequest().authenticated())
                .addFilterBefore(supabaseJwtFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}