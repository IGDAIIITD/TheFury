package com.campusforge.backend.trade.dto;

import com.campusforge.backend.trade.Trade;
import com.campusforge.backend.trade.TradeCard;
import com.campusforge.backend.trade.TradeSide;
import com.campusforge.backend.trade.TradeStatus;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public record TradeDto(
        UUID id,
        TradeStatus status,
        TradePlayerDto sender,
        TradePlayerDto receiver,
        List<TradeCardDto> offered,
        List<TradeCardDto> requested,
        LocalDateTime createdAt,
        LocalDateTime resolvedAt,
        LocalDateTime expiresAt
) {
    public record TradePlayerDto(
            UUID id,
            String displayName,
            String avatar,
            String studentId,
            String degreeLevel,
            String specialization
    ) {
        public static TradePlayerDto from(com.campusforge.backend.accounts.Player player) {
            return new TradePlayerDto(
                    player.getId(),
                    player.getDisplayName(),
                    player.getAvatar(),
                    player.getStudentId(),
                    player.getDegreeLevel(),
                    player.getSpecialization());
        }
    }

    public static TradeDto from(Trade trade) {
        return new TradeDto(
                trade.getId(),
                trade.getStatus(),
                TradePlayerDto.from(trade.getSender()),
                TradePlayerDto.from(trade.getReceiver()),
                trade.getCards().stream()
                        .filter(c -> c.getSide() == TradeSide.OFFERED)
                        .map(c -> TradeCardDto.from(TradeSide.OFFERED, c.getUniqueCard()))
                        .toList(),
                trade.getCards().stream()
                        .filter(c -> c.getSide() == TradeSide.REQUESTED)
                        .map(c -> TradeCardDto.from(TradeSide.REQUESTED, c.getUniqueCard()))
                        .toList(),
                trade.getCreatedAt(),
                trade.getResolvedAt(),
                trade.getExpiresAt());
    }
}
