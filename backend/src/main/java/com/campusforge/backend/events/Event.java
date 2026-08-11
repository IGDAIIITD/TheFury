package com.campusforge.backend.events;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "events")
public class Event {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<List<String>> SETS_TYPE = new TypeReference<>() {
    };

    @Id
    @GeneratedValue
    @UuidGenerator
    @Column(columnDefinition = "UUID")
    private UUID id;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(name = "allowed_sets_json", nullable = false, columnDefinition = "TEXT")
    private String allowedSetsJson;

    @Column(name = "bonus_multiplier", nullable = false, precision = 5, scale = 2)
    private BigDecimal bonusMultiplier = BigDecimal.ONE;

    @Column(name = "start_time", nullable = false)
    private LocalDateTime startTime;

    @Column(name = "end_time", nullable = false)
    private LocalDateTime endTime;

    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    public Event() {
    }

    public Event(String name, List<String> allowedSets, BigDecimal bonusMultiplier,
                 LocalDateTime startTime, LocalDateTime endTime) {
        this.name = name;
        setAllowedSets(allowedSets);
        this.bonusMultiplier = bonusMultiplier;
        this.startTime = startTime;
        this.endTime = endTime;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getAllowedSetsJson() {
        return allowedSetsJson;
    }

    public void setAllowedSetsJson(String allowedSetsJson) {
        this.allowedSetsJson = allowedSetsJson;
    }

    public List<String> getAllowedSets() {
        if (allowedSetsJson == null || allowedSetsJson.isBlank()) {
            return List.of();
        }
        try {
            return MAPPER.readValue(allowedSetsJson, SETS_TYPE);
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    public void setAllowedSets(List<String> sets) {
        try {
            this.allowedSetsJson = MAPPER.writeValueAsString(sets);
        } catch (Exception e) {
            this.allowedSetsJson = "[]";
        }
    }

    /** Empty allowed-set list means the event imposes no set restriction. */
    public boolean allowsSet(String setCode) {
        List<String> sets = getAllowedSets();
        return sets.isEmpty() || setCode != null && sets.contains(setCode);
    }

    public BigDecimal getBonusMultiplier() {
        return bonusMultiplier;
    }

    public void setBonusMultiplier(BigDecimal bonusMultiplier) {
        this.bonusMultiplier = bonusMultiplier;
    }

    public LocalDateTime getStartTime() {
        return startTime;
    }

    public void setStartTime(LocalDateTime startTime) {
        this.startTime = startTime;
    }

    public LocalDateTime getEndTime() {
        return endTime;
    }

    public void setEndTime(LocalDateTime endTime) {
        this.endTime = endTime;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
}
