package com.campusforge.battleengine.battle;

import com.campusforge.battleengine.battle.dto.CreateLobbyRequest;
import com.campusforge.battleengine.battle.dto.CreateMatchRequest;
import com.campusforge.battleengine.battle.dto.JoinMatchRequest;
import com.campusforge.battleengine.battle.dto.MatchDto;
import com.campusforge.battleengine.security.SupabaseJwt.BattleIdentity;
import com.campusforge.battleengine.supabase.SupabaseClient;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Battle REST surface for the standalone engine. Same paths as the backend's
 * {@code BattleController}, but the acting player is the Supabase {@code sub}.
 * The engine is the only writer of the {@code matches} table (service role), so
 * match history reads and terminal-state fallbacks also flow through here.
 */
@RestController
@RequestMapping("/api/v1/battle")
public class BattleController {

    private final MatchManager matchManager;
    private final SupabaseClient supabase;

    public BattleController(MatchManager matchManager, SupabaseClient supabase) {
        this.matchManager = matchManager;
        this.supabase = supabase;
    }

    @PostMapping("/create")
    public ResponseEntity<MatchDto> createMatch(
            @AuthenticationPrincipal BattleIdentity principal,
            @RequestBody CreateMatchRequest request) {
        MatchDto match = matchManager.createMatch(
                principal.playerId(),
                request.deckId(),
                request.opponentPlayerId(),
                request.opponentDeckId(),
                request.eventId()
        );
        return ResponseEntity.ok(match);
    }

    @PostMapping("/lobby")
    public ResponseEntity<MatchDto> createLobby(
            @AuthenticationPrincipal BattleIdentity principal,
            @RequestBody CreateLobbyRequest request) {
        MatchDto match = matchManager.createLobbyMatch(principal.playerId(), request.deckId(), request.eventId());
        return ResponseEntity.ok(match);
    }

    @PostMapping("/join")
    public ResponseEntity<MatchDto> joinMatch(
            @AuthenticationPrincipal BattleIdentity principal,
            @RequestBody JoinMatchRequest request) {
        MatchDto match = matchManager.joinMatch(request.code(), principal.playerId(), request.deckId());
        return ResponseEntity.ok(match);
    }

    @GetMapping("/features")
    public Map<String, Object> features() {
        return Map.of("aiBattlesEnabled", matchManager.isAiBattlesEnabled());
    }

    @GetMapping("/matches")
    public List<MatchDto> listMatches(@AuthenticationPrincipal BattleIdentity principal) {
        UUID playerId = principal.playerId();
        return supabase.matchesForPlayer(playerId).stream().map(MatchDto::from).toList();
    }

    @GetMapping("/matches/{matchId}")
    public MatchDto getMatch(@PathVariable UUID matchId) {
        return MatchDto.from(supabase.findMatch(matchId)
                .orElseThrow(() -> new com.campusforge.battleengine.common.ResourceNotFoundException("Match not found: " + matchId)));
    }

    @GetMapping("/matches/{matchId}/state")
    public ResponseEntity<Map<String, Object>> getMatchState(
            @AuthenticationPrincipal BattleIdentity principal,
            @PathVariable UUID matchId) {
        Map<String, Object> state = matchManager.getState(matchId, principal.playerId());
        if (state == null) {
            var match = supabase.findMatch(matchId)
                    .orElseThrow(() -> new com.campusforge.battleengine.common.ResourceNotFoundException("Match not found: " + matchId));
            boolean terminal = "COMPLETED".equals(MatchDto.from(match).status())
                    || "CONCEDED".equals(MatchDto.from(match).status());
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("matchId", matchId.toString());
            body.put("status", MatchDto.from(match).status());
            body.put("gameOver", terminal);
            body.put("winnerId", match.winnerId() != null ? match.winnerId().toString() : null);
            body.put("winCondition", match.winCondition());
            if (match.winnerId() != null && terminal) {
                String winnerName = supabase.displayName(match.winnerId()).orElse(null);
                body.put("winnerName", winnerName);
            }
            body.put("battleCode", match.battleCode() != null ? match.battleCode() : null);
            return ResponseEntity.ok(body);
        }
        return ResponseEntity.ok(state);
    }

    @PostMapping("/matches/{matchId}/concede")
    public ResponseEntity<Void> concede(
            @AuthenticationPrincipal BattleIdentity principal,
            @PathVariable UUID matchId) {
        matchManager.reportConcede(matchId, principal.playerId());
        return ResponseEntity.noContent().build();
    }
}