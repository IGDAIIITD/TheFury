package com.campusforge.backend.deck;

import com.campusforge.backend.collection.Card;
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

import java.util.UUID;

@Entity
@Table(name = "card_legalities", uniqueConstraints = @UniqueConstraint(
        name = "uk_card_legalities_card_format", columnNames = {"card_id", "format_id"}))
public class CardLegality {

    @Id
    @GeneratedValue
    @UuidGenerator
    @Column(columnDefinition = "UUID")
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "card_id", nullable = false)
    private Card card;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "format_id", nullable = false)
    private Format format;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Legality legality;

    public CardLegality() {
    }

    public CardLegality(Card card, Format format, Legality legality) {
        this.card = card;
        this.format = format;
        this.legality = legality;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public Card getCard() {
        return card;
    }

    public void setCard(Card card) {
        this.card = card;
    }

    public Format getFormat() {
        return format;
    }

    public void setFormat(Format format) {
        this.format = format;
    }

    public Legality getLegality() {
        return legality;
    }

    public void setLegality(Legality legality) {
        this.legality = legality;
    }
}
