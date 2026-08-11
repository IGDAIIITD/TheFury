package com.campusforge.backend.collection;

import com.campusforge.backend.accounts.Player;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UniqueCardRepository extends JpaRepository<UniqueCard, UUID> {
    List<UniqueCard> findByOwner(Player owner);
    boolean existsByPhysicalUuid(UUID physicalUuid);
    long countByOwner(Player owner);

    @Query("select coalesce(max(uc.serialNumber), 0) from UniqueCard uc where uc.card = :card")
    int maxSerialNumberByCard(@Param("card") Card card);

    @Query("select uc from UniqueCard uc where uc.physicalUuid = :id")
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<UniqueCard> findByIdForUpdate(@Param("id") UUID id);

    @Query("select uc from UniqueCard uc where uc.physicalUuid in :uuids order by uc.physicalUuid")
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    List<UniqueCard> findAllByIdForUpdate(@Param("uuids") Collection<UUID> uuids);
}
