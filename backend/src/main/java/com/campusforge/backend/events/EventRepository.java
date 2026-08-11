package com.campusforge.backend.events;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public interface EventRepository extends JpaRepository<Event, UUID> {

    @Query("select e from Event e where e.active = true and e.startTime <= :now and e.endTime >= :now order by e.startTime")
    List<Event> findActive(@Param("now") LocalDateTime now);

    List<Event> findAllByOrderByStartTimeDesc();
}
