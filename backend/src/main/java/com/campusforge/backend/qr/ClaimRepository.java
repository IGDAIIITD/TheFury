package com.campusforge.backend.qr;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ClaimRepository extends JpaRepository<Claim, UUID> {

    Optional<Claim> findByTokenCore(String tokenCore);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Claim c where c.tokenCore = :tokenCore")
    Optional<Claim> findByTokenCoreForUpdate(@Param("tokenCore") String tokenCore);

    boolean existsByTokenCore(String tokenCore);

    List<Claim> findByStatus(ClaimStatus status);

    List<Claim> findByClaimedById(UUID claimedById);
}
