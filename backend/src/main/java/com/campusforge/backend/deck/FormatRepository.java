package com.campusforge.backend.deck;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FormatRepository extends JpaRepository<Format, UUID> {
    Optional<Format> findByCode(String code);
    List<Format> findAllByOrderByCode();
}
