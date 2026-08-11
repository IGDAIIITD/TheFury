package com.campusforge.backend.collection;

import com.campusforge.backend.accounts.Player;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
@Table(name = "discoveries", uniqueConstraints = @UniqueConstraint(
        name = "uk_discoveries_player_card", columnNames = {"player_id", "card_id"}))
public class Discovery {

    @Id
    @GeneratedValue
    @UuidGenerator
    @Column(columnDefinition = "UUID")
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "player_id", nullable = false)
    private Player player;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "card_id", nullable = false)
    private Card card;

    @Column(nullable = false)
    private long count;

    @Column(nullable = false)
    private LocalDateTime lastDiscovered;

    public Discovery() {
    }

    public Discovery(Player player, Card card) {
        this.player = player;
        this.card = card;
        this.count = 1;
        this.lastDiscovered = LocalDateTime.now();
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public Player getPlayer() {
        return player;
    }

    public void setPlayer(Player player) {
        this.player = player;
    }

    public Card getCard() {
        return card;
    }

    public void setCard(Card card) {
        this.card = card;
    }

    public long getCount() {
        return count;
    }

    public void setCount(long count) {
        this.count = count;
    }

    public LocalDateTime getLastDiscovered() {
        return lastDiscovered;
    }

    public void setLastDiscovered(LocalDateTime lastDiscovered) {
        this.lastDiscovered = lastDiscovered;
    }
}
