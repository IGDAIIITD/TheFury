package com.campusforge.backend.trade;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TradeRepository extends JpaRepository<Trade, UUID> {

    @Query("select t from Trade t where t.id = :id")
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Trade> findByIdForUpdate(@Param("id") UUID id);

    List<Trade> findBySenderIdAndStatus(UUID senderId, TradeStatus status);

    List<Trade> findByReceiverIdAndStatus(UUID receiverId, TradeStatus status);

    List<Trade> findByStatus(TradeStatus status);

    @Query("select count(t) from Trade t where t.status = :status and (t.sender.id = :playerId or t.receiver.id = :playerId)")
    long countByStatusAndPlayer(@Param("status") TradeStatus status, @Param("playerId") UUID playerId);
}
