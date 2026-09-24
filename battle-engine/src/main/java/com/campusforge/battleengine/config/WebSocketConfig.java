package com.campusforge.battleengine.config;

import com.campusforge.battleengine.security.SupabaseStompAuthChannelInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * STOMP broker for live battle state. Player actions arrive at
 * {@code /app/match/{matchId}/action}; per-seat state is pushed to
 * {@code /topic/match/{matchId}/p{index}}. Transport: native WebSocket at
 * {@code /ws/match}. WS auth = Supabase access-token JWT.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final SupabaseStompAuthChannelInterceptor supabaseStompAuthChannelInterceptor;

    public WebSocketConfig(SupabaseStompAuthChannelInterceptor supabaseStompAuthChannelInterceptor) {
        this.supabaseStompAuthChannelInterceptor = supabaseStompAuthChannelInterceptor;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic");
        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(supabaseStompAuthChannelInterceptor);
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // Native WebSocket only (the PWA uses @stomp/stompjs brokerURL). SockJS was
        // dropped: its client registers a legacy 'unload' listener and rejects
        // ws:// / wss:// URLs. Any origin may connect; STOMP CONNECT requires a
        // valid Supabase access token (SupabaseStompAuthChannelInterceptor).
        registry.addEndpoint("/ws/match").setAllowedOriginPatterns("*");
    }
}