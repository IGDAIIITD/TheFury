package com.campusforge.backend.collection;

import com.campusforge.backend.accounts.Player;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "unique_cards", uniqueConstraints = @UniqueConstraint(
        name = "uk_unique_cards_serial", columnNames = {"card_id", "serial_number"}))
public class UniqueCard {

    @Id
    @Column(columnDefinition = "UUID")
    private UUID physicalUuid;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "owner_id", nullable = false)
    private Player owner;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "card_id", nullable = false)
    private Card card;

    @Column(nullable = false)
    private int serialNumber;

    @Column(nullable = false)
    private LocalDateTime claimedAt;

    @Column(columnDefinition = "text")
    private String history;

    public UniqueCard() {
    }

    public UniqueCard(UUID physicalUuid, Player owner, Card card, int serialNumber, String history) {
        this.physicalUuid = physicalUuid;
        this.owner = owner;
        this.card = card;
        this.serialNumber = serialNumber;
        this.claimedAt = LocalDateTime.now();
        this.history = history;
    }

    public UUID getPhysicalUuid() {
        return physicalUuid;
    }

    public void setPhysicalUuid(UUID physicalUuid) {
        this.physicalUuid = physicalUuid;
    }

    public Player getOwner() {
        return owner;
    }

    public void setOwner(Player owner) {
        this.owner = owner;
    }

    public Card getCard() {
        return card;
    }

    public void setCard(Card card) {
        this.card = card;
    }

    public int getSerialNumber() {
        return serialNumber;
    }

    public void setSerialNumber(int serialNumber) {
        this.serialNumber = serialNumber;
    }

    public LocalDateTime getClaimedAt() {
        return claimedAt;
    }

    public void setClaimedAt(LocalDateTime claimedAt) {
        this.claimedAt = claimedAt;
    }

    public String getHistory() {
        return history;
    }

    public void setHistory(String history) {
        this.history = history;
    }
}
