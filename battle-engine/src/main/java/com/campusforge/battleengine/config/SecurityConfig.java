package com.campusforge.battleengine.config;

import com.campusforge.battleengine.security.SupabaseJwtFilter;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

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
    private final List<String> allowedOrigins;

    public SecurityConfig(SupabaseJwtFilter supabaseJwtFilter,
                          @Value("${campusforge.cors.allowed-origins:http://localhost:17170,http://127.0.0.1:17170}") String origins) {
        this.supabaseJwtFilter = supabaseJwtFilter;
        this.allowedOrigins = Arrays.stream(origins.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(allowedOrigins);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "X-Requested-With"));
        config.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
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