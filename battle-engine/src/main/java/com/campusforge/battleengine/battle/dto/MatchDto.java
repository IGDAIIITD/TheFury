package com.campusforge.battleengine.battle.dto;

import com.campusforge.battleengine.supabase.SupabaseClient.SupabaseMatch;

import java.util.UUID;

/**
 * Battle-engine MatchDto. Status vocabulary mirrors the Supabase matches column:
 * WAITING/PENDING → PENDING, ACTIVE → ACTIVE, FINISHED/COMPLETED → COMPLETED,
 * CONCEDED → CONCEDED, so the web client typing ({@code 'PENDING' | 'ACTIVE' |
 * 'COMPLETED' | 'CONCEDED'}) stays unchanged.
 */
public record MatchDto(
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
        String createdAt
) {
    public static MatchDto from(SupabaseMatch m) {
        return new MatchDto(
                m.id(),
                m.player1Id(),
                m.player2Id(),
                m.deck1Id(),
                m.deck2Id(),
                normalizeStatus(m.status()),
                m.winnerId(),
                m.winCondition(),
                m.battleCode(),
                m.eventId(),
                m.createdAt()
        );
    }

    private static String normalizeStatus(String raw) {
        if (raw == null) {
            return "PENDING";
        }
        return switch (raw) {
            case "ACTIVE" -> "ACTIVE";
            case "FINISHED", "COMPLETED" -> "COMPLETED";
            case "CONCEDED" -> "CONCEDED";
            default -> "PENDING";
        };
    }
}