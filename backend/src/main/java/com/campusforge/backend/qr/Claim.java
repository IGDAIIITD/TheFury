package com.campusforge.backend.qr;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.events.Event;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "claims", uniqueConstraints = @UniqueConstraint(
        name = "uk_claims_token", columnNames = "token"))
public class Claim {

    @Id
    @GeneratedValue
    @UuidGenerator
    @Column(columnDefinition = "UUID")
    private UUID id;

    @Column(nullable = false, unique = true)
    private String token;

    @Column(name = "token_core", nullable = false, unique = true)
    private String tokenCore;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "card_id", nullable = false)
    private Card card;

    private String building;

    private LocalDateTime expiresAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ClaimStatus status;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "claimed_by")
    private Player claimedBy;

    private LocalDateTime claimedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "event_id")
    private Event event;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "spawned_by")
    private Player spawnedBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    public Claim() {
    }

    public Claim(String token, String tokenCore, Card card, String building, LocalDateTime expiresAt) {
        this.token = token;
        this.tokenCore = tokenCore;
        this.card = card;
        this.building = building;
        this.expiresAt = expiresAt;
        this.status = ClaimStatus.ACTIVE;
        this.createdAt = LocalDateTime.now();
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public String getTokenCore() {
        return tokenCore;
    }

    public void setTokenCore(String tokenCore) {
        this.tokenCore = tokenCore;
    }

    public Card getCard() {
        return card;
    }

    public void setCard(Card card) {
        this.card = card;
    }

    public String getBuilding() {
        return building;
    }

    public void setBuilding(String building) {
        this.building = building;
    }

    public LocalDateTime getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(LocalDateTime expiresAt) {
        this.expiresAt = expiresAt;
    }

    public ClaimStatus getStatus() {
        return status;
    }

    public void setStatus(ClaimStatus status) {
        this.status = status;
    }

    public Player getClaimedBy() {
        return claimedBy;
    }

    public void setClaimedBy(Player claimedBy) {
        this.claimedBy = claimedBy;
    }

    public LocalDateTime getClaimedAt() {
        return claimedAt;
    }

    public void setClaimedAt(LocalDateTime claimedAt) {
        this.claimedAt = claimedAt;
    }

    public Event getEvent() {
        return event;
    }

    public void setEvent(Event event) {
        this.event = event;
    }

    public Player getSpawnedBy() {
        return spawnedBy;
    }

    public void setSpawnedBy(Player spawnedBy) {
        this.spawnedBy = spawnedBy;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
}
