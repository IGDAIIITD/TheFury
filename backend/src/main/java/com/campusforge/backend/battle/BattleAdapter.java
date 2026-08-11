package com.campusforge.backend.battle;

import java.util.UUID;

public interface BattleAdapter {
    void startGame(UUID matchId, UUID player1Id, UUID deck1Id, UUID player2Id, UUID deck2Id);
    void finishGame(UUID matchId, UUID winnerId, String winCondition);
    void reportDisconnect(UUID matchId, UUID playerId);
    void reportConcede(UUID matchId, UUID playerId);
}
