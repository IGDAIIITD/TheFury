package com.campusforge.backend.trade;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.UniqueCard;
import com.campusforge.backend.collection.UniqueCardRepository;
import com.campusforge.backend.common.events.TradeAcceptedEvent;
import com.campusforge.backend.trade.dto.CreateTradeRequest;
import com.campusforge.backend.trade.dto.TradeDto;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class TradeService {

    public static final Duration TRADE_TTL = Duration.ofHours(24);

    private final TradeRepository tradeRepository;
    private final UniqueCardRepository uniqueCardRepository;
    private final PlayerRepository playerRepository;
    private final ApplicationEventPublisher publisher;

    public TradeService(TradeRepository tradeRepository,
                        UniqueCardRepository uniqueCardRepository,
                        PlayerRepository playerRepository,
                        ApplicationEventPublisher publisher) {
        this.tradeRepository = tradeRepository;
        this.uniqueCardRepository = uniqueCardRepository;
        this.playerRepository = playerRepository;
        this.publisher = publisher;
    }

    @Transactional
    public TradeDto create(UUID senderId, CreateTradeRequest request) {
        if (request.receiverId().equals(senderId)) {
            throw new TradeException(HttpStatus.BAD_REQUEST, "You cannot trade with yourself");
        }
        Player receiver = playerRepository.findById(request.receiverId())
                .orElseThrow(() -> new TradeException(HttpStatus.NOT_FOUND, "Receiver not found"));
        Player sender = playerRepository.getReferenceById(senderId);

        validateBundles(request, senderId, receiver);

        Trade trade = new Trade(sender, receiver, LocalDateTime.now(), LocalDateTime.now().plus(TRADE_TTL));
        for (UUID uuid : request.offeredPhysicalUuids()) {
            UniqueCard card = uniqueCardRepository.findById(uuid)
                    .orElseThrow(() -> new TradeException(HttpStatus.NOT_FOUND, "Offered unique card not found: " + uuid));
            trade.addCard(new TradeCard(TradeSide.OFFERED, card));
        }
        for (UUID uuid : request.requestedPhysicalUuids()) {
            UniqueCard card = uniqueCardRepository.findById(uuid)
                    .orElseThrow(() -> new TradeException(HttpStatus.NOT_FOUND, "Requested unique card not found: " + uuid));
            trade.addCard(new TradeCard(TradeSide.REQUESTED, card));
        }
        return TradeDto.from(tradeRepository.save(trade));
    }

    @Transactional
    public TradeDto accept(UUID actorId, UUID tradeId) {
        Trade trade = lockPendingTrade(tradeId, actorId, TradeSide.REQUESTED, "receiver");
        List<UniqueCard> locked = uniqueCardRepository.findAllByIdForUpdate(sortedCardUuids(trade));
        for (UniqueCard card : locked) {
            boolean offered = isOffered(trade, card.getPhysicalUuid());
            Player expected = offered ? trade.getSender() : trade.getReceiver();
            if (!card.getOwner().getId().equals(expected.getId())) {
                throw new TradeException(HttpStatus.CONFLICT,
                        "Ownership changed; trade no longer valid: " + card.getCard().getForgeName());
            }
        }
        for (UniqueCard card : locked) {
            Player from = card.getOwner();
            Player to = isOffered(trade, card.getPhysicalUuid()) ? trade.getReceiver() : trade.getSender();
            card.setOwner(to);
            appendHistory(card, from, to, trade);
        }
        trade.setStatus(TradeStatus.ACCEPTED);
        trade.setResolvedAt(LocalDateTime.now());
        publisher.publishEvent(new TradeAcceptedEvent(
                trade.getSender().getId(), trade.getSender().getDisplayName(),
                trade.getReceiver().getId(), trade.getReceiver().getDisplayName()));
        return TradeDto.from(trade);
    }

    @Transactional
    public TradeDto decline(UUID actorId, UUID tradeId) {
        Trade trade = lockPendingTrade(tradeId, actorId, TradeSide.REQUESTED, "receiver");
        trade.setStatus(TradeStatus.DECLINED);
        trade.setResolvedAt(LocalDateTime.now());
        return TradeDto.from(trade);
    }

    @Transactional
    public TradeDto cancel(UUID actorId, UUID tradeId) {
        Trade trade = lockPendingTrade(tradeId, actorId, TradeSide.OFFERED, "sender");
        trade.setStatus(TradeStatus.CANCELLED);
        trade.setResolvedAt(LocalDateTime.now());
        return TradeDto.from(trade);
    }

    @Transactional(readOnly = true)
    public TradeDto get(UUID actorId, UUID tradeId) {
        Trade trade = tradeRepository.findById(tradeId)
                .orElseThrow(() -> new TradeException(HttpStatus.NOT_FOUND, "Trade not found: " + tradeId));
        requireParticipant(trade, actorId);
        return TradeDto.from(trade);
    }

    @Transactional
    public List<TradeDto> incoming(UUID actorId) {
        return expireAll(tradeRepository.findByReceiverIdAndStatus(actorId, TradeStatus.PENDING))
                .stream().map(TradeDto::from).toList();
    }

    @Transactional
    public List<TradeDto> outgoing(UUID actorId) {
        return expireAll(tradeRepository.findBySenderIdAndStatus(actorId, TradeStatus.PENDING))
                .stream().map(TradeDto::from).toList();
    }

    private List<Trade> expireAll(List<Trade> trades) {
        List<Trade> changed = new ArrayList<>();
        for (Trade trade : trades) {
            if (isExpired(trade)) {
                trade.setStatus(TradeStatus.EXPIRED);
                trade.setResolvedAt(LocalDateTime.now());
                changed.add(trade);
            }
        }
        if (!changed.isEmpty()) {
            tradeRepository.saveAll(changed);
        }
        return trades;
    }

    private Trade lockPendingTrade(UUID tradeId, UUID actorId, TradeSide expectedSide, String role) {
        Trade trade = tradeRepository.findByIdForUpdate(tradeId)
                .orElseThrow(() -> new TradeException(HttpStatus.NOT_FOUND, "Trade not found: " + tradeId));
        requireParticipant(trade, actorId);
        boolean isSender = trade.getSender().getId().equals(actorId);
        if (isSender != (expectedSide == TradeSide.OFFERED)) {
            throw new TradeException(HttpStatus.FORBIDDEN,
                    "Only the " + role + " can perform this action on the trade");
        }
        if (trade.getStatus() != TradeStatus.PENDING) {
            throw new TradeException(HttpStatus.CONFLICT, "Trade is already " + trade.getStatus().name().toLowerCase());
        }
        if (isExpired(trade)) {
            throw new TradeException(HttpStatus.GONE, "Trade has expired");
        }
        return trade;
    }

    private boolean isExpired(Trade trade) {
        return trade.getStatus() == TradeStatus.PENDING
                && trade.getExpiresAt() != null
                && trade.getExpiresAt().isBefore(LocalDateTime.now());
    }

    private void requireParticipant(Trade trade, UUID actorId) {
        if (!trade.getSender().getId().equals(actorId) && !trade.getReceiver().getId().equals(actorId)) {
            throw new TradeException(HttpStatus.NOT_FOUND, "Trade not found: " + trade.getId());
        }
    }

    private List<UUID> sortedCardUuids(Trade trade) {
        return trade.getCards().stream()
                .map(c -> c.getUniqueCard().getPhysicalUuid())
                .sorted()
                .toList();
    }

    private boolean isOffered(Trade trade, UUID physicalUuid) {
        return trade.getCards().stream()
                .anyMatch(c -> c.getSide() == TradeSide.OFFERED
                        && c.getUniqueCard().getPhysicalUuid().equals(physicalUuid));
    }

    private void validateBundles(CreateTradeRequest request, UUID senderId, Player receiver) {
        requireNoDuplicates(request.offeredPhysicalUuids(), "offered");
        requireNoDuplicates(request.requestedPhysicalUuids(), "requested");

        Set<UUID> offered = new HashSet<>(request.offeredPhysicalUuids());
        Set<UUID> requested = new HashSet<>(request.requestedPhysicalUuids());
        Set<UUID> overlap = new HashSet<>(offered);
        overlap.retainAll(requested);
        if (!overlap.isEmpty()) {
            throw new TradeException(HttpStatus.BAD_REQUEST,
                    "A card cannot be both offered and requested: " + overlap.iterator().next());
        }

        for (UUID uuid : offered) {
            UniqueCard card = uniqueCardRepository.findById(uuid)
                    .orElseThrow(() -> new TradeException(HttpStatus.NOT_FOUND, "Offered unique card not found: " + uuid));
            if (!card.getOwner().getId().equals(senderId)) {
                throw new TradeException(HttpStatus.BAD_REQUEST,
                        "You do not own offered card: " + card.getCard().getForgeName());
            }
        }
        for (UUID uuid : requested) {
            UniqueCard card = uniqueCardRepository.findById(uuid)
                    .orElseThrow(() -> new TradeException(HttpStatus.NOT_FOUND, "Requested unique card not found: " + uuid));
            if (!card.getOwner().getId().equals(receiver.getId())) {
                throw new TradeException(HttpStatus.BAD_REQUEST,
                        "Receiver does not own requested card: " + card.getCard().getForgeName());
            }
        }
    }

    private void requireNoDuplicates(List<UUID> uuids, String side) {
        if (uuids.stream().distinct().count() != uuids.size()) {
            throw new TradeException(HttpStatus.BAD_REQUEST, "Duplicate " + side + " card in bundle");
        }
    }

    private void appendHistory(UniqueCard card, Player from, Player to, Trade trade) {
        String entry = LocalDateTime.now() + ": " + from.getDisplayName() + " \u2192 " + to.getDisplayName()
                + " via trade " + trade.getId();
        String current = card.getHistory();
        card.setHistory(current == null || current.isBlank() ? entry : current + "\n" + entry);
    }
}
