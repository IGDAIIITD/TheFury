package com.campusforge.backend.battle;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MatchRepository extends JpaRepository<Match, UUID> {
    List<Match> findByPlayer1IdOrPlayer2Id(UUID player1Id, UUID player2Id);

    Optional<Match> findByBattleCode(String battleCode);
}
