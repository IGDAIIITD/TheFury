package com.campusforge.backend.collection;

import com.campusforge.backend.accounts.Player;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DiscoveryRepository extends JpaRepository<Discovery, UUID> {
    Optional<Discovery> findByPlayerAndCard(Player player, Card card);
    List<Discovery> findByPlayer(Player player);
    long countByPlayer(Player player);
}
