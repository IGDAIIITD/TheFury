package com.campusforge.battleengine.security;

import com.campusforge.battleengine.security.SupabaseJwt.BattleIdentity;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * Authenticates STOMP connections against the Supabase access-token JWT in the
 * CONNECT frame's {@code Authorization} header and records match-topic
 * subscriptions so WebSocket disconnects can be mapped back to a match + player.
 * Mirrors the backend's {@code StompAuthChannelInterceptor} but uses Supabase Auth.
 */
@Component
public class SupabaseStompAuthChannelInterceptor implements ChannelInterceptor {

    private static final String BEARER_PREFIX = "Bearer ";

    private final SupabaseJwt supabaseJwt;

    private final ConcurrentMap<String, List<Subscription>> subscriptionsBySession = new ConcurrentHashMap<>();

    public SupabaseStompAuthChannelInterceptor(SupabaseJwt supabaseJwt) {
        this.supabaseJwt = supabaseJwt;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null) {
            return message;
        }

        if (StompCommand.CONNECT.equals(accessor.getCommand())) {
            authenticate(accessor);
        } else if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
            recordSubscription(accessor);
        }
        return message;
    }

    private void authenticate(StompHeaderAccessor accessor) {
        String header = accessor.getFirstNativeHeader("Authorization");
        if (header == null || !header.startsWith(BEARER_PREFIX)) {
            throw new MessagingException("Missing or invalid Authorization header on WebSocket connect");
        }
        String token = header.substring(BEARER_PREFIX.length());
        BattleIdentity identity = supabaseJwt.parse(token);
        if (identity == null) {
            throw new MessagingException("Invalid Supabase token");
        }
        UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(identity, null, List.of());
        accessor.setUser(auth);
    }

    private void recordSubscription(StompHeaderAccessor accessor) {
        String destination = accessor.getDestination();
        if (destination == null || !destination.startsWith("/topic/match/")) {
            return;
        }
        String sessionId = accessor.getSessionId();
        if (sessionId == null) {
            return;
        }
        // /topic/match/{matchId}/p{playerIndex}
        String[] parts = destination.split("/");
        if (parts.length < 5) {
            return;
        }
        try {
            UUID matchId = UUID.fromString(parts[3]);
            int playerIndex = Integer.parseInt(parts[4].substring(1));
            subscriptionsBySession
                    .computeIfAbsent(sessionId, k -> new ArrayList<>())
                    .add(new Subscription(matchId, playerIndex));
        } catch (IllegalArgumentException ignored) {
            // not a match topic we care about
        }
    }

    /** Match-topic subscriptions recorded for a WebSocket session id. */
    public List<Subscription> subscriptionsFor(String sessionId) {
        List<Subscription> list = subscriptionsBySession.remove(sessionId);
        return list == null ? List.of() : list;
    }

    public record Subscription(UUID matchId, int playerIndex) {
    }
}