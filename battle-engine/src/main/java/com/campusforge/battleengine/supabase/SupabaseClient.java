package com.campusforge.battleengine.supabase;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Service-role PostgREST client for the battle engine. Reads decks/profiles/
 * matches and calls the {@code validate_deck} + {@code record_match_result} RPCs.
 * The engine never uses RLS-visible credentials — it always acts as service role,
 * mirroring the Edge Function pattern.
 */
@Component
public class SupabaseClient {

    private static final Logger log = LoggerFactory.getLogger(SupabaseClient.class);

    private final String baseUrl;
    private final String serviceRoleKey;
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    public SupabaseClient(@Value("${supabase.url}") String baseUrl,
                          @Value("${supabase.service-role-key}") String serviceRoleKey) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.serviceRoleKey = serviceRoleKey;
    }

    // ------------------------------------------------------------------
    // Decks
    // ------------------------------------------------------------------

    /** Loads a deck plus its card slot {@code forge_name}s and quantities. */
    public Optional<SupabaseDeck> findDeck(UUID deckId) {
        String url = baseUrl + "/rest/v1/decks?id=eq." + deckId
                + "&select=id,player_id,name,format_code,commander_card_id,deck_cards(card_id,quantity,cards(forge_name))";
        try {
            HttpResponse<byte[]> res = get(url);
            if (res.statusCode() == 200) {
                JsonNode arr = mapper.readTree(res.body());
                if (!arr.isArray() || arr.isEmpty()) {
                    return Optional.empty();
                }
                return Optional.of(parseDeck(arr.get(0)));
            }
            if (res.statusCode() == 404) {
                return Optional.empty();
            }
            log.warn("findDeck {} status {}", deckId, res.statusCode());
            return Optional.empty();
        } catch (Exception e) {
            log.warn("findDeck {} failed", deckId, e);
            return Optional.empty();
        }
    }

    private SupabaseDeck parseDeck(JsonNode node) {
        UUID id = UUID.fromString(node.path("id").asText());
        UUID playerId = node.path("player_id").isNull() ? null : UUID.fromString(node.path("player_id").asText());
        String name = node.path("name").asText();
        String formatCode = node.path("format_code").asText();
        UUID commander = node.path("commander_card_id").isNull()
                ? null : UUID.fromString(node.path("commander_card_id").asText());
        List<SupabaseDeck.CardSlot> cards = new ArrayList<>();
        JsonNode slots = node.path("deck_cards");
        if (slots.isArray()) {
            for (JsonNode slot : slots) {
                JsonNode card = slot.path("cards");
                cards.add(new SupabaseDeck.CardSlot(
                        card.path("forge_name").asText(),
                        slot.path("quantity").asInt()));
            }
        }
        return new SupabaseDeck(id, playerId, name, formatCode, commander, cards);
    }

    // ------------------------------------------------------------------
    // Profiles
    // ------------------------------------------------------------------

    public Optional<String> displayName(UUID playerId) {
        String url = baseUrl + "/rest/v1/profiles?id=eq." + playerId + "&select=display_name";
        try {
            HttpResponse<byte[]> res = get(url);
            if (res.statusCode() == 200) {
                JsonNode arr = mapper.readTree(res.body());
                if (arr.isArray() && !arr.isEmpty()) {
                    return Optional.of(arr.get(0).path("display_name").asText());
                }
            }
        } catch (Exception e) {
            log.warn("displayName {} failed", playerId, e);
        }
        return Optional.empty();
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    public Optional<SupabaseEvent> findEvent(UUID eventId) {
        String url = baseUrl + "/rest/v1/events?id=eq." + eventId
                + "&select=id,name,bonus_multiplier,start_time,end_time,active";
        try {
            HttpResponse<byte[]> res = get(url);
            if (res.statusCode() == 200) {
                JsonNode arr = mapper.readTree(res.body());
                if (arr.isArray() && !arr.isEmpty()) {
                    JsonNode n = arr.get(0);
                    return Optional.of(new SupabaseEvent(
                            UUID.fromString(n.path("id").asText()),
                            n.path("name").asText(),
                            n.path("bonus_multiplier").asDouble(1.0),
                            n.path("start_time").asText(),
                            n.path("end_time").asText(),
                            n.path("active").asBoolean(true)));
                }
            }
        } catch (Exception e) {
            log.warn("findEvent {} failed", eventId, e);
        }
        return Optional.empty();
    }

    // ------------------------------------------------------------------
    // Deck validation RPC
    // ------------------------------------------------------------------

    /** Runs {@code validate_deck(p_deck, p_event)}; empty result = valid. */
    public List<DeckProblem> validateDeck(UUID deckId, UUID eventId) {
        Map<String, Object> body = new HashMap<>();
        body.put("p_deck", deckId.toString());
        body.put("p_event", eventId != null ? eventId.toString() : null);
        try {
            HttpResponse<byte[]> res = rpc("validate_deck", body);
            if (res.statusCode() == 200) {
                JsonNode arr = mapper.readTree(res.body());
                List<DeckProblem> out = new ArrayList<>();
                if (arr.isArray()) {
                    for (JsonNode n : arr) {
                        out.add(new DeckProblem(
                                n.path("severity").asText(),
                                n.path("code").asText(),
                                n.path("message").asText()));
                    }
                }
                return out;
            }
            if (res.statusCode() == 404) {
                return List.of(new DeckProblem("ERROR", "NOT_FOUND", "deck not found"));
            }
            log.warn("validate_deck status {}", res.statusCode());
            return List.of(new DeckProblem("ERROR", "INTERNAL", "failed to validate deck"));
        } catch (Exception e) {
            log.warn("validate_deck failed", e);
            return List.of(new DeckProblem("ERROR", "INTERNAL", "failed to validate deck"));
        }
    }

    // ------------------------------------------------------------------
    // Matches
    // ------------------------------------------------------------------

    public Optional<SupabaseMatch> findMatch(UUID matchId) {
        String url = baseUrl + "/rest/v1/matches?id=eq." + matchId + "&select=*";
        try {
            HttpResponse<byte[]> res = get(url);
            if (res.statusCode() == 200) {
                JsonNode arr = mapper.readTree(res.body());
                if (arr.isArray() && !arr.isEmpty()) {
                    return Optional.of(parseMatch(arr.get(0)));
                }
            }
        } catch (Exception e) {
            log.warn("findMatch {} failed", matchId, e);
        }
        return Optional.empty();
    }

    public Optional<SupabaseMatch> findByBattleCode(String code) {
        String url = baseUrl + "/rest/v1/matches?battle_code=eq." + enc(code) + "&select=*";
        try {
            HttpResponse<byte[]> res = get(url);
            if (res.statusCode() == 200) {
                JsonNode arr = mapper.readTree(res.body());
                if (arr.isArray() && !arr.isEmpty()) {
                    return Optional.of(parseMatch(arr.get(0)));
                }
            }
        } catch (Exception e) {
            log.warn("findByBattleCode {} failed", code, e);
        }
        return Optional.empty();
    }

    public List<SupabaseMatch> matchesForPlayer(UUID playerId) {
        String url = baseUrl + "/rest/v1/matches?or=(player1_id.eq." + playerId + ",player2_id.eq." + playerId
                + ")&order=created_at.asc&select=*";
        List<SupabaseMatch> out = new ArrayList<>();
        try {
            HttpResponse<byte[]> res = get(url);
            if (res.statusCode() == 200) {
                JsonNode arr = mapper.readTree(res.body());
                if (arr.isArray()) {
                    for (JsonNode n : arr) {
                        out.add(parseMatch(n));
                    }
                }
            }
        } catch (Exception e) {
            log.warn("matchesForPlayer {} failed", playerId, e);
        }
        return out;
    }

    public boolean battleCodeExists(String code) {
        String url = baseUrl + "/rest/v1/matches?battle_code=eq." + enc(code) + "&select=id";
        try {
            HttpResponse<byte[]> res = get(url);
            return res.statusCode() == 200 && mapper.readTree(res.body()).isArray()
                    && mapper.readTree(res.body()).size() > 0;
        } catch (Exception e) {
            return true; // be conservative on failure
        }
    }

    /** Inserts a matches row (battle-engine is the only writer, service role). */
    public Optional<SupabaseMatch> insertMatch(SupabaseMatch match) {
        Map<String, Object> body = new HashMap<>();
        body.put("id", match.id().toString());
        body.put("player1_id", match.player1Id().toString());
        body.put("player2_id", match.player2Id() != null ? match.player2Id().toString() : null);
        body.put("deck1_id", match.deck1Id().toString());
        body.put("deck2_id", match.deck2Id() != null ? match.deck2Id().toString() : null);
        body.put("status", match.status());
        body.put("winner_id", match.winnerId() != null ? match.winnerId().toString() : null);
        body.put("win_condition", match.winCondition());
        body.put("battle_code", match.battleCode());
        body.put("event_id", match.eventId() != null ? match.eventId().toString() : null);
        try {
            String url = baseUrl + "/rest/v1/matches";
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .header("apikey", serviceRoleKey)
                    .header("Authorization", "Bearer " + serviceRoleKey)
                    .header("Content-Type", "application/json")
                    .header("Prefer", "return=representation")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    .build();
            HttpResponse<byte[]> res = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (res.statusCode() == 201 || res.statusCode() == 200) {
                JsonNode arr = mapper.readTree(res.body());
                if (arr.isArray() && !arr.isEmpty()) {
                    return Optional.of(parseMatch(arr.get(0)));
                }
                return Optional.of(match);
            }
            log.warn("insertMatch status {} body {}", res.statusCode(),
                    new String(res.body(), StandardCharsets.UTF_8));
            return Optional.empty();
        } catch (Exception e) {
            log.warn("insertMatch failed", e);
            return Optional.empty();
        }
    }

    /**
     * Claims a WAITING lobby for the second player. The update is conditional on
     * {@code status = WAITING} (a single Postgres UPDATE ... WHERE), so exactly one
     * of several concurrent joiners wins; the others get an empty result.
     */
    public Optional<SupabaseMatch> activateMatch(UUID matchId, UUID player2Id, UUID deck2Id) {
        Map<String, Object> body = new HashMap<>();
        body.put("player2_id", player2Id.toString());
        body.put("deck2_id", deck2Id.toString());
        body.put("status", "ACTIVE");
        return patchMatch(matchId, body, "&status=eq.WAITING");
    }

    /** Records the terminal state via the service-role RPC (XP + feed + status). */
    public void recordMatchResult(UUID matchId, UUID winnerId, String winCondition) {
        Map<String, Object> body = new HashMap<>();
        body.put("p_match", matchId.toString());
        body.put("p_winner", winnerId != null ? winnerId.toString() : null);
        body.put("p_win_cond", winCondition);
        try {
            HttpResponse<byte[]> res = rpc("record_match_result", body);
            if (res.statusCode() >= 200 && res.statusCode() < 300) {
                log.info("record_match_result {} winner={} ok", matchId, winnerId);
            } else {
                log.warn("record_match_result status {}", res.statusCode());
            }
        } catch (Exception e) {
            log.warn("record_match_result failed", e);
        }
    }

    /** Marks a contested match as CONCEDED + winner via direct service-role patch. */
    public Optional<SupabaseMatch> markConceded(UUID matchId, UUID winnerId, String winCondition) {
        Map<String, Object> body = new HashMap<>();
        body.put("status", "CONCEDED");
        body.put("winner_id", winnerId != null ? winnerId.toString() : null);
        body.put("win_condition", winCondition);
        return patchMatch(matchId, body);
    }

    private Optional<SupabaseMatch> patchMatch(UUID matchId, Map<String, Object> body) {
        return patchMatch(matchId, body, "");
    }

    /** PATCH with extra PostgREST filters (e.g. "&status=eq.WAITING"); empty = no row matched. */
    private Optional<SupabaseMatch> patchMatch(UUID matchId, Map<String, Object> body, String extraFilter) {
        String url = baseUrl + "/rest/v1/matches?id=eq." + matchId + extraFilter;
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .header("apikey", serviceRoleKey)
                    .header("Authorization", "Bearer " + serviceRoleKey)
                    .header("Content-Type", "application/json")
                    .header("Prefer", "return=representation")
                    .method("PATCH", HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    .build();
            HttpResponse<byte[]> res = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (res.statusCode() == 200) {
                JsonNode arr = mapper.readTree(res.body());
                if (arr.isArray() && !arr.isEmpty()) {
                    return Optional.of(parseMatch(arr.get(0)));
                }
            }
            if (res.statusCode() != 200 || extraFilter.isEmpty()) {
                log.warn("patchMatch {} status {}", matchId, res.statusCode());
            }
            return Optional.empty();
        } catch (Exception e) {
            log.warn("patchMatch {} failed", matchId, e);
            return Optional.empty();
        }
    }

    private SupabaseMatch parseMatch(JsonNode node) {
        return new SupabaseMatch(
                UUID.fromString(node.path("id").asText()),
                UUID.fromString(node.path("player1_id").asText()),
                node.path("player2_id").isNull() ? null : UUID.fromString(node.path("player2_id").asText()),
                UUID.fromString(node.path("deck1_id").asText()),
                node.path("deck2_id").isNull() ? null : UUID.fromString(node.path("deck2_id").asText()),
                node.path("status").asText(),
                node.path("winner_id").isNull() ? null : UUID.fromString(node.path("winner_id").asText()),
                node.path("win_condition").isNull() ? null : node.path("win_condition").asText(),
                node.path("battle_code").isNull() ? null : node.path("battle_code").asText(),
                node.path("event_id").isNull() ? null : UUID.fromString(node.path("event_id").asText()),
                node.path("created_at").isNull() ? null : node.path("created_at").asText(),
                node.path("ended_at").isNull() ? null : node.path("ended_at").asText());
    }

    // ------------------------------------------------------------------
    // HTTP helpers
    // ------------------------------------------------------------------

    private HttpResponse<byte[]> get(String url) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .header("apikey", serviceRoleKey)
                .header("Authorization", "Bearer " + serviceRoleKey)
                .header("Accept", "application/json")
                .GET()
                .build();
        return http.send(req, HttpResponse.BodyHandlers.ofByteArray());
    }

    private HttpResponse<byte[]> rpc(String fn, Map<String, Object> body) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/rest/v1/rpc/" + fn))
                .header("apikey", serviceRoleKey)
                .header("Authorization", "Bearer " + serviceRoleKey)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                .build();
        return http.send(req, HttpResponse.BodyHandlers.ofByteArray());
    }

    private static String enc(String raw) {
        return URLEncoder.encode(raw, StandardCharsets.UTF_8);
    }

    // ------------------------------------------------------------------
    // DTOs
    // ------------------------------------------------------------------

    public record SupabaseDeck(
            UUID id,
            UUID playerId,
            String name,
            String formatCode,
            UUID commanderCardId,
            List<CardSlot> cards
    ) {
        public record CardSlot(String forgeName, int quantity) {
        }
    }

    public record SupabaseMatch(
            UUID id,
            UUID player1Id,
            UUID player2Id,
            UUID deck1Id,
            UUID deck2Id,
            String status,
            UUID winnerId,
            String winCondition,
            String battleCode,
            UUID eventId,
            String createdAt,
            String endedAt
    ) {
    }

    public record DeckProblem(String severity, String code, String message) {
    }

    public record SupabaseEvent(
            UUID id,
            String name,
            double bonusMultiplier,
            String startTime,
            String endTime,
            boolean active
    ) {
    }
}