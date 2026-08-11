package com.campusforge.backend.battle;

import com.campusforge.backend.battle.dto.CreateLobbyRequest;
import com.campusforge.backend.battle.dto.CreateMatchRequest;
import com.campusforge.backend.battle.dto.JoinMatchRequest;
import com.campusforge.backend.battle.dto.MatchDto;
import com.campusforge.backend.security.PlayerPrincipal;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/battle")
public class BattleController {

    private final MatchManager matchManager;
    private final MatchRepository matchRepository;

    public BattleController(MatchManager matchManager, MatchRepository matchRepository) {
        this.matchManager = matchManager;
        this.matchRepository = matchRepository;
    }

    @PostMapping("/create")
    public ResponseEntity<MatchDto> createMatch(
            @AuthenticationPrincipal PlayerPrincipal principal,
            @RequestBody CreateMatchRequest request) {
        Match match = matchManager.createMatch(
                principal.getPlayer().getId(),
                request.deckId(),
                request.opponentPlayerId(),
                request.opponentDeckId(),
                request.eventId()
        );
        return ResponseEntity.ok(MatchDto.from(match));
    }

    @PostMapping("/lobby")
    public ResponseEntity<MatchDto> createLobby(
            @AuthenticationPrincipal PlayerPrincipal principal,
            @RequestBody CreateLobbyRequest request) {
        Match match = matchManager.createLobbyMatch(principal.getPlayer().getId(), request.deckId(), request.eventId());
        return ResponseEntity.ok(MatchDto.from(match));
    }

    @PostMapping("/join")
    public ResponseEntity<MatchDto> joinMatch(
            @AuthenticationPrincipal PlayerPrincipal principal,
            @RequestBody JoinMatchRequest request) {
        Match match = matchManager.joinMatch(request.code(), principal.getPlayer().getId(), request.deckId());
        return ResponseEntity.ok(MatchDto.from(match));
    }

    @GetMapping("/features")
    public Map<String, Object> features() {
        return Map.of("aiBattlesEnabled", matchManager.isAiBattlesEnabled());
    }

    @GetMapping("/matches")
    public List<MatchDto> listMatches(@AuthenticationPrincipal PlayerPrincipal principal) {
        UUID playerId = principal.getPlayer().getId();
        return matchRepository.findByPlayer1IdOrPlayer2Id(playerId, playerId)
                .stream().map(MatchDto::from).toList();
    }

    @GetMapping("/matches/{matchId}")
    public MatchDto getMatch(@PathVariable UUID matchId) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new com.campusforge.backend.common.ResourceNotFoundException("Match not found: " + matchId));
        return MatchDto.from(match);
    }

    @GetMapping("/matches/{matchId}/state")
    public ResponseEntity<Map<String, Object>> getMatchState(
            @AuthenticationPrincipal PlayerPrincipal principal,
            @PathVariable UUID matchId) {
        Map<String, Object> state = matchManager.getState(matchId, principal.getPlayer().getId());
        if (state == null) {
            Match match = matchRepository.findById(matchId)
                    .orElseThrow(() -> new com.campusforge.backend.common.ResourceNotFoundException("Match not found: " + matchId));
            boolean terminal = Match.MatchStatus.COMPLETED.equals(match.getStatus())
                    || Match.MatchStatus.CONCEDED.equals(match.getStatus());
            Map<String, Object> body = new java.util.LinkedHashMap<>();
            body.put("matchId", matchId.toString());
            body.put("status", match.getStatus().name());
            body.put("gameOver", terminal);
            body.put("winnerId", match.getWinnerId() != null ? match.getWinnerId().toString() : null);
            body.put("winCondition", match.getWinCondition());
            if (match.getWinnerId() != null && terminal) {
                if (match.getPlayer1() != null && match.getPlayer1().getId().equals(match.getWinnerId())) {
                    body.put("winnerName", match.getPlayer1().getDisplayName());
                } else if (match.getPlayer2() != null && match.getPlayer2().getId().equals(match.getWinnerId())) {
                    body.put("winnerName", match.getPlayer2().getDisplayName());
                }
            }
            body.put("battleCode", match.getBattleCode() != null ? match.getBattleCode() : null);
            return ResponseEntity.ok(body);
        }
        return ResponseEntity.ok(state);
    }

    @PostMapping("/matches/{matchId}/concede")
    public ResponseEntity<Void> concede(
            @AuthenticationPrincipal PlayerPrincipal principal,
            @PathVariable UUID matchId) {
        matchManager.reportConcede(matchId, principal.getPlayer().getId());
        return ResponseEntity.noContent().build();
    }
}
