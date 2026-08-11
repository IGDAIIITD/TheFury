package com.campusforge.backend.achievements;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface PlayerAchievementRepository extends JpaRepository<PlayerAchievement, UUID> {

    boolean existsByPlayerIdAndCode(UUID playerId, String code);

    List<PlayerAchievement> findByPlayerIdOrderByUnlockedAt(UUID playerId);
}
