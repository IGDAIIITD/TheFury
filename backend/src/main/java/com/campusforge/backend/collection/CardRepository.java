package com.campusforge.backend.collection;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CardRepository extends JpaRepository<Card, UUID> {
    Optional<Card> findByOracleId(String oracleId);
    boolean existsByOracleId(String oracleId);
    Optional<Card> findByForgeName(String forgeName);
    List<Card> findByOwnershipType(OwnershipType ownershipType);
    List<Card> findByForgeNameContainingIgnoreCase(String name);
}
