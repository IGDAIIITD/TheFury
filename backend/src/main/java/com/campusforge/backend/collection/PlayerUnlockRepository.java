package com.campusforge.backend.collection;

import com.campusforge.backend.accounts.Player;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PlayerUnlockRepository extends JpaRepository<PlayerUnlock, UUID> {
    boolean existsByPlayerAndCard(Player player, Card card);
    Optional<PlayerUnlock> findByPlayerAndCard(Player player, Card card);
    List<PlayerUnlock> findByPlayer(Player player);
    long countByPlayer(Player player);
}
