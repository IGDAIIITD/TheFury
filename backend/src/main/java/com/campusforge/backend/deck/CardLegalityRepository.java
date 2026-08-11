package com.campusforge.backend.deck;

import com.campusforge.backend.collection.Card;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CardLegalityRepository extends JpaRepository<CardLegality, UUID> {
    Optional<CardLegality> findByCardIdAndFormatId(UUID cardId, UUID formatId);
    List<CardLegality> findByFormatId(UUID formatId);
    boolean existsByCard(Card card);
}
