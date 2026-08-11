package com.campusforge.backend.collection;

import com.campusforge.backend.accounts.Player;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FavoriteRepository extends JpaRepository<Favorite, UUID> {
    boolean existsByPlayerAndCard(Player player, Card card);
    Optional<Favorite> findByPlayerAndCard(Player player, Card card);
    List<Favorite> findByPlayer(Player player);
}
