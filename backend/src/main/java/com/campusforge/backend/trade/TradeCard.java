package com.campusforge.backend.trade;

import com.campusforge.backend.collection.UniqueCard;
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
@Table(name = "trade_cards", uniqueConstraints = @UniqueConstraint(
        name = "uk_trade_cards_trade_side_card", columnNames = {"trade_id", "side", "physical_uuid"}))
public class TradeCard {

    @Id
    @GeneratedValue
    @UuidGenerator
    @Column(columnDefinition = "UUID")
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "trade_id", nullable = false)
    private Trade trade;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TradeSide side;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "physical_uuid", nullable = false)
    private UniqueCard uniqueCard;

    public TradeCard() {
    }

    public TradeCard(TradeSide side, UniqueCard uniqueCard) {
        this.side = side;
        this.uniqueCard = uniqueCard;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public Trade getTrade() {
        return trade;
    }

    public void setTrade(Trade trade) {
        this.trade = trade;
    }

    public TradeSide getSide() {
        return side;
    }

    public void setSide(TradeSide side) {
        this.side = side;
    }

    public UniqueCard getUniqueCard() {
        return uniqueCard;
    }

    public void setUniqueCard(UniqueCard uniqueCard) {
        this.uniqueCard = uniqueCard;
    }
}
