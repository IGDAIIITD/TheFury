package com.campusforge.backend.trade;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.OwnershipType;
import com.campusforge.backend.collection.UniqueCard;
import com.campusforge.backend.collection.UniqueCardRepository;
import com.campusforge.backend.trade.dto.CreateTradeRequest;
import com.campusforge.backend.trade.dto.TradeDto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TradeServiceTest {

    @Mock
    TradeRepository tradeRepository;
    @Mock
    UniqueCardRepository uniqueCardRepository;
    @Mock
    PlayerRepository playerRepository;
    @Mock
    ApplicationEventPublisher publisher;

    TradeService service;

    Player sender;
    Player receiver;
    UUID senderId;
    UUID receiverId;
    UniqueCard lotusSender;
    UniqueCard lotusReceiver;
    UniqueCard moxSender;
    UUID offered;
    UUID requested;

    @BeforeEach
    void setUp() {
        service = new TradeService(tradeRepository, uniqueCardRepository, playerRepository, publisher);

        senderId = UUID.randomUUID();
        receiverId = UUID.randomUUID();
        sender = player(senderId, "Sender");
        receiver = player(receiverId, "Receiver");

        Card lotus = new Card("oracle-lotus", "Black Lotus", "Mythic", OwnershipType.UNIQUE,
                "LEA", 0, "Artifact", "", null, false, "Special", 0.1);
        Card mox = new Card("oracle-mox", "Mox Sapphire", "Rare", OwnershipType.UNIQUE,
                "LEA", 0, "Artifact", "", null, false, "Special", 0.1);
        lotusSender = uniqueCard(UUID.randomUUID(), sender, lotus, 1);
        moxSender = uniqueCard(UUID.randomUUID(), sender, mox, 2);
        lotusReceiver = uniqueCard(UUID.randomUUID(), receiver, lotus, 3);
        offered = lotusSender.getPhysicalUuid();
        requested = lotusReceiver.getPhysicalUuid();
    }

    private Player player(UUID id, String name) {
        Player p = new Player();
        p.setId(id);
        p.setEmail(name.toLowerCase() + "@campus.edu");
        p.setDisplayName(name);
        return p;
    }

    private UniqueCard uniqueCard(UUID uuid, Player owner, Card card, int serial) {
        UniqueCard uc = new UniqueCard();
        uc.setPhysicalUuid(uuid);
        uc.setOwner(owner);
        uc.setCard(card);
        uc.setSerialNumber(serial);
        return uc;
    }

    private Trade pendingTrade() {
        Trade trade = new Trade(sender, receiver, LocalDateTime.now().minusMinutes(1),
                LocalDateTime.now().plusHours(23));
        trade.setId(UUID.randomUUID());
        trade.addCard(new TradeCard(TradeSide.OFFERED, lotusSender));
        trade.addCard(new TradeCard(TradeSide.REQUESTED, lotusReceiver));
        return trade;
    }

    @Test
    void createBuildsPendingTradeWithBothBundles() {
        when(playerRepository.findById(receiverId)).thenReturn(Optional.of(receiver));
        when(playerRepository.getReferenceById(senderId)).thenReturn(sender);
        when(uniqueCardRepository.findById(offered)).thenReturn(Optional.of(lotusSender));
        when(uniqueCardRepository.findById(requested)).thenReturn(Optional.of(lotusReceiver));
        when(tradeRepository.save(any(Trade.class))).thenAnswer(inv -> inv.getArgument(0));

        TradeDto dto = service.create(senderId,
                new CreateTradeRequest(receiverId, List.of(offered), List.of(requested)));

        assertThat(dto.status()).isEqualTo(TradeStatus.PENDING);
        assertThat(dto.sender().id()).isEqualTo(senderId);
        assertThat(dto.receiver().id()).isEqualTo(receiverId);
        assertThat(dto.offered()).extracting("physicalUuid").containsExactly(offered);
        assertThat(dto.requested()).extracting("physicalUuid").containsExactly(requested);
        assertThat(dto.expiresAt()).isAfter(dto.createdAt());
        verify(tradeRepository).save(any(Trade.class));
    }

    @Test
    void createRejectsSelfTrade() {
        assertThatThrownBy(() -> service.create(senderId,
                new CreateTradeRequest(senderId, List.of(offered), List.of(requested))))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        verify(tradeRepository, never()).save(any(Trade.class));
    }

    @Test
    void createRejectsUnknownReceiver() {
        when(playerRepository.findById(receiverId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.create(senderId,
                new CreateTradeRequest(receiverId, List.of(offered), List.of(requested))))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void createRejectsOverlappingCardOnBothSides() {
        when(playerRepository.findById(receiverId)).thenReturn(Optional.of(receiver));

        assertThatThrownBy(() -> service.create(senderId,
                new CreateTradeRequest(receiverId, List.of(offered), List.of(offered))))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        verify(uniqueCardRepository, never()).findById(any(UUID.class));
    }

    @Test
    void createRejectsDuplicateWithinBundle() {
        when(playerRepository.findById(receiverId)).thenReturn(Optional.of(receiver));

        assertThatThrownBy(() -> service.create(senderId,
                new CreateTradeRequest(receiverId, List.of(offered, offered), List.of(requested))))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void createRejectsCardSenderDoesNotOwn() {
        when(playerRepository.findById(receiverId)).thenReturn(Optional.of(receiver));
        when(uniqueCardRepository.findById(offered)).thenReturn(Optional.of(lotusReceiver));

        assertThatThrownBy(() -> service.create(senderId,
                new CreateTradeRequest(receiverId, List.of(offered), List.of(requested))))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void createRejectsRequestedCardReceiverDoesNotOwn() {
        when(playerRepository.findById(receiverId)).thenReturn(Optional.of(receiver));
        when(uniqueCardRepository.findById(offered)).thenReturn(Optional.of(lotusSender));
        when(uniqueCardRepository.findById(requested)).thenReturn(Optional.of(moxSender));

        assertThatThrownBy(() -> service.create(senderId,
                new CreateTradeRequest(receiverId, List.of(offered), List.of(requested))))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void createRejectsMissingOfferedCard() {
        when(playerRepository.findById(receiverId)).thenReturn(Optional.of(receiver));
        when(uniqueCardRepository.findById(offered)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.create(senderId,
                new CreateTradeRequest(receiverId, List.of(offered), List.of(requested))))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void acceptSwapsOwnershipAndAppendsHistory() {
        Trade trade = pendingTrade();
        when(tradeRepository.findByIdForUpdate(trade.getId())).thenReturn(Optional.of(trade));
        when(uniqueCardRepository.findAllByIdForUpdate(any(Collection.class)))
                .thenReturn(List.of(lotusSender, lotusReceiver));

        TradeDto dto = service.accept(receiverId, trade.getId());

        assertThat(dto.status()).isEqualTo(TradeStatus.ACCEPTED);
        assertThat(lotusSender.getOwner().getId()).isEqualTo(receiverId);
        assertThat(lotusReceiver.getOwner().getId()).isEqualTo(senderId);
        assertThat(lotusSender.getHistory()).contains("via trade " + trade.getId());
        assertThat(lotusReceiver.getHistory()).contains("via trade " + trade.getId());
    }

    @Test
    void acceptOnResolvedTradeIsConflict() {
        Trade trade = pendingTrade();
        trade.setStatus(TradeStatus.DECLINED);
        when(tradeRepository.findByIdForUpdate(trade.getId())).thenReturn(Optional.of(trade));

        assertThatThrownBy(() -> service.accept(receiverId, trade.getId()))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT));
        verify(uniqueCardRepository, never()).findAllByIdForUpdate(any(Collection.class));
    }

    @Test
    void acceptBySenderIsForbidden() {
        Trade trade = pendingTrade();
        when(tradeRepository.findByIdForUpdate(trade.getId())).thenReturn(Optional.of(trade));

        assertThatThrownBy(() -> service.accept(senderId, trade.getId()))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.FORBIDDEN));
        verify(uniqueCardRepository, never()).findAllByIdForUpdate(any(Collection.class));
    }

    @Test
    void acceptWhenOwnershipChangedIsConflict() {
        Trade trade = pendingTrade();
        lotusSender.setOwner(receiver);
        when(tradeRepository.findByIdForUpdate(trade.getId())).thenReturn(Optional.of(trade));
        when(uniqueCardRepository.findAllByIdForUpdate(any(Collection.class)))
                .thenReturn(List.of(lotusSender, lotusReceiver));

        assertThatThrownBy(() -> service.accept(receiverId, trade.getId()))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void acceptOnExpiredTradeIsGone() {
        Trade trade = pendingTrade();
        trade.setExpiresAt(LocalDateTime.now().minusMinutes(1));
        when(tradeRepository.findByIdForUpdate(trade.getId())).thenReturn(Optional.of(trade));

        assertThatThrownBy(() -> service.accept(receiverId, trade.getId()))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.GONE));
        verify(uniqueCardRepository, never()).findAllByIdForUpdate(any(Collection.class));
    }

    @Test
    void declineByReceiverResolvesDeclined() {
        Trade trade = pendingTrade();
        when(tradeRepository.findByIdForUpdate(trade.getId())).thenReturn(Optional.of(trade));

        TradeDto dto = service.decline(receiverId, trade.getId());

        assertThat(dto.status()).isEqualTo(TradeStatus.DECLINED);
        assertThat(dto.resolvedAt()).isNotNull();
    }

    @Test
    void declineBySenderIsForbidden() {
        Trade trade = pendingTrade();
        when(tradeRepository.findByIdForUpdate(trade.getId())).thenReturn(Optional.of(trade));

        assertThatThrownBy(() -> service.decline(senderId, trade.getId()))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.FORBIDDEN));
    }

    @Test
    void cancelBySenderResolvesCancelled() {
        Trade trade = pendingTrade();
        when(tradeRepository.findByIdForUpdate(trade.getId())).thenReturn(Optional.of(trade));

        TradeDto dto = service.cancel(senderId, trade.getId());

        assertThat(dto.status()).isEqualTo(TradeStatus.CANCELLED);
    }

    @Test
    void cancelByReceiverIsForbidden() {
        Trade trade = pendingTrade();
        when(tradeRepository.findByIdForUpdate(trade.getId())).thenReturn(Optional.of(trade));

        assertThatThrownBy(() -> service.cancel(receiverId, trade.getId()))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.FORBIDDEN));
    }

    @Test
    void getByNonParticipantIsNotFound() {
        Trade trade = pendingTrade();
        Player stranger = player(UUID.randomUUID(), "Stranger");
        when(tradeRepository.findById(trade.getId())).thenReturn(Optional.of(trade));

        assertThatThrownBy(() -> service.get(stranger.getId(), trade.getId()))
                .isInstanceOf(TradeException.class)
                .satisfies(e -> assertThat(((TradeException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void incomingExpiresStalePendingTrades() {
        Trade stale = pendingTrade();
        stale.setExpiresAt(LocalDateTime.now().minusMinutes(5));
        when(tradeRepository.findByReceiverIdAndStatus(receiverId, TradeStatus.PENDING)).thenReturn(List.of(stale));
        when(tradeRepository.saveAll(any(Collection.class))).thenAnswer(inv -> inv.getArgument(0));

        List<TradeDto> dtos = service.incoming(receiverId);

        assertThat(dtos).hasSize(1);
        assertThat(dtos.get(0).status()).isEqualTo(TradeStatus.EXPIRED);
        assertThat(stale.getStatus()).isEqualTo(TradeStatus.EXPIRED);
        verify(tradeRepository).saveAll(eq(List.of(stale)));
    }

    @Test
    void outgoingKeepsFreshPendingTradesPending() {
        Trade fresh = pendingTrade();
        when(tradeRepository.findBySenderIdAndStatus(senderId, TradeStatus.PENDING)).thenReturn(List.of(fresh));

        List<TradeDto> dtos = service.outgoing(senderId);

        assertThat(dtos).hasSize(1);
        assertThat(dtos.get(0).status()).isEqualTo(TradeStatus.PENDING);
        verify(tradeRepository, never()).saveAll(any(Collection.class));
    }
}
