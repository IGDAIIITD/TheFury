package com.campusforge.backend.deck;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DeckRepository extends JpaRepository<Deck, UUID> {
    Optional<Deck> findByIdAndPlayerId(UUID deckId, UUID playerId);
    List<Deck> findByPlayerId(UUID playerId);
}
