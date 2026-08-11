package com.campusforge.backend.accounts;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PlayerRepository extends JpaRepository<Player, UUID> {
    Optional<Player> findByEmail(String email);
    boolean existsByEmail(String email);
    List<Player> findTop10ByDisplayNameContainingIgnoreCase(String displayName);
    List<Player> findTop10ByEmailContainingIgnoreCase(String email);
}
