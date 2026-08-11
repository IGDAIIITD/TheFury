package com.campusforge.backend.battle.dto;

import com.campusforge.backend.battle.Match;

import java.time.LocalDateTime;
import java.util.UUID;

public record MatchDto(
        UUID id,
        UUID player1Id,
        UUID player2Id,
        UUID deck1Id,
        UUID deck2Id,
        Match.MatchStatus status,
        UUID winnerId,
        String winCondition,
        String battleCode,
        UUID eventId,
        String eventName,
        LocalDateTime createdAt
) {
    public static MatchDto from(Match match) {
        return new MatchDto(
                match.getId(),
                match.getPlayer1().getId(),
                match.getPlayer2() != null ? match.getPlayer2().getId() : null,
                match.getDeck1().getId(),
                match.getDeck2() != null ? match.getDeck2().getId() : null,
                match.getStatus(),
                match.getWinnerId(),
                match.getWinCondition(),
                match.getBattleCode(),
                match.getEvent() != null ? match.getEvent().getId() : null,
                match.getEvent() != null ? match.getEvent().getName() : null,
                match.getCreatedAt()
        );
    }
}
