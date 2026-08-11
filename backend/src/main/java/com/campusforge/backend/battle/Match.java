package com.campusforge.backend.battle;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.deck.Deck;
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
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "matches")
public class Match {

    public enum MatchStatus {
        PENDING, ACTIVE, COMPLETED, CONCEDED
    }

    @Id
    @GeneratedValue
    @UuidGenerator
    @Column(columnDefinition = "UUID")
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "player1_id", nullable = false)
    private Player player1;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "player2_id")
    private Player player2;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "deck1_id", nullable = false)
    private Deck deck1;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "deck2_id")
    private Deck deck2;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private MatchStatus status = MatchStatus.PENDING;

    @Column(columnDefinition = "UUID")
    private UUID winnerId;

    @Column(name = "win_condition", length = 64)
    private String winCondition;

    @Column(name = "battle_code", length = 16, unique = true)
    private String battleCode;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "event_id")
    private Event event;

    @Column(nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    private LocalDateTime endedAt;

    public Match() {
    }

    public Match(Player player1, Deck deck1, Player player2, Deck deck2) {
        this.player1 = player1;
        this.deck1 = deck1;
        this.player2 = player2;
        this.deck2 = deck2;
        this.status = MatchStatus.ACTIVE;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public Player getPlayer1() {
        return player1;
    }

    public void setPlayer1(Player player1) {
        this.player1 = player1;
    }

    public Player getPlayer2() {
        return player2;
    }

    public void setPlayer2(Player player2) {
        this.player2 = player2;
    }

    public Deck getDeck1() {
        return deck1;
    }

    public void setDeck1(Deck deck1) {
        this.deck1 = deck1;
    }

    public Deck getDeck2() {
        return deck2;
    }

    public void setDeck2(Deck deck2) {
        this.deck2 = deck2;
    }

    public MatchStatus getStatus() {
        return status;
    }

    public void setStatus(MatchStatus status) {
        this.status = status;
    }

    public UUID getWinnerId() {
        return winnerId;
    }

    public void setWinnerId(UUID winnerId) {
        this.winnerId = winnerId;
    }

    public String getWinCondition() {
        return winCondition;
    }

    public void setWinCondition(String winCondition) {
        this.winCondition = winCondition;
    }

    public String getBattleCode() {
        return battleCode;
    }

    public void setBattleCode(String battleCode) {
        this.battleCode = battleCode;
    }

    public Event getEvent() {
        return event;
    }

    public void setEvent(Event event) {
        this.event = event;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getEndedAt() {
        return endedAt;
    }

    public void setEndedAt(LocalDateTime endedAt) {
        this.endedAt = endedAt;
    }
}
