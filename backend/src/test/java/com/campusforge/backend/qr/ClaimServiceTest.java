package com.campusforge.backend.qr;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.collection.CollectionService;
import com.campusforge.backend.collection.OwnershipType;
import com.campusforge.backend.collection.dto.DiscoverResultDto;
import com.campusforge.backend.events.EventService;
import com.campusforge.backend.qr.dto.ClaimDto;
import com.campusforge.backend.qr.dto.ClaimResultDto;
import com.campusforge.backend.qr.dto.MintClaimRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ClaimServiceTest {

    @Mock
    ClaimRepository claimRepository;
    @Mock
    CollectionService collectionService;
    @Mock
    PlayerRepository playerRepository;
    @Mock
    CardRepository cardRepository;
    @Mock
    EventService eventService;
    @Mock
    ApplicationEventPublisher publisher;

    ClaimService service;
    QrCodeSigner signer = new QrCodeSigner("test-secret");

    Player player;
    Player admin;
    Card counterspell;
    Card blackLotus;
    UUID physicalUuid;

    @BeforeEach
    void setUp() {
        service = new ClaimService(claimRepository, collectionService, playerRepository,
                cardRepository, eventService, signer, publisher);

        player = new Player();
        player.setId(UUID.randomUUID());
        player.setEmail("tester@campus.edu");
        player.setDisplayName("Tester");

        admin = new Player();
        admin.setId(UUID.randomUUID());
        admin.setEmail("admin@campus.edu");
        admin.setDisplayName("Admin");

        counterspell = new Card("oracle-counter", "Counterspell", "Common", OwnershipType.UNLOCK,
                "M19", 2, "Instant", "U", null, true, "Building B", 5.0);
        blackLotus = new Card("oracle-lotus", "Black Lotus", "Mythic", OwnershipType.UNIQUE,
                "LEA", 0, "Artifact", "", null, false, "Special", 0.1);
        counterspell.setId(UUID.randomUUID());
        blackLotus.setId(UUID.randomUUID());

        physicalUuid = ClaimService.physicalUuidFor("UNLOCKTOKEN123");
    }

    private Claim activeClaim(Card card) {
        return new Claim("UNLOCKTOKEN123", "UNLOCKTOKEN123", card, "Building B", null);
    }

    @Test
    void validUnlockClaimUnlocksCardAndKeepsTokenActive() {
        Claim claim = activeClaim(counterspell);
        when(claimRepository.findByTokenCoreForUpdate(claim.getToken())).thenReturn(Optional.of(claim));
        when(collectionService.discover(player.getId(), counterspell.getId()))
                .thenReturn(DiscoverResultDto.unlocked(counterspell, 1, CollectionService.XP_PER_UNLOCK));
        when(playerRepository.getReferenceById(player.getId())).thenReturn(player);

        ClaimResultDto result = service.claim(player.getId(), claim.getToken());

        assertThat(result.unlocked()).isTrue();
        assertThat(result.token()).isEqualTo(claim.getToken());
        assertThat(result.building()).isEqualTo("Building B");
        assertThat(claim.getStatus()).isEqualTo(ClaimStatus.ACTIVE);
        assertThat(claim.getClaimedBy()).isEqualTo(player);
        verify(claimRepository).save(claim);
    }

    @Test
    void unlockClaimForOwnedCardReturnsAlreadyOwned() {
        Claim claim = activeClaim(counterspell);
        when(claimRepository.findByTokenCoreForUpdate(claim.getToken())).thenReturn(Optional.of(claim));
        when(collectionService.discover(player.getId(), counterspell.getId()))
                .thenReturn(DiscoverResultDto.alreadyOwned(counterspell, 2));
        when(playerRepository.getReferenceById(player.getId())).thenReturn(player);

        ClaimResultDto result = service.claim(player.getId(), claim.getToken());

        assertThat(result.alreadyOwned()).isTrue();
        assertThat(result.discoveryCount()).isEqualTo(2);
        assertThat(claim.getStatus()).isEqualTo(ClaimStatus.ACTIVE);
        assertThat(claim.getClaimedBy()).isEqualTo(player);
        verify(claimRepository).save(claim);
    }

    @Test
    void uniqueClaimBindsPhysicalUuidToTokenAndConsumesIt() {
        Claim claim = activeClaim(blackLotus);
        when(claimRepository.findByTokenCoreForUpdate(claim.getToken())).thenReturn(Optional.of(claim));
        when(collectionService.discover(player.getId(), blackLotus.getId(), ClaimService.physicalUuidFor(claim.getToken())))
                .thenReturn(DiscoverResultDto.unlocked(blackLotus, 1, CollectionService.XP_PER_UNLOCK));
        when(playerRepository.getReferenceById(player.getId())).thenReturn(player);

        ClaimResultDto result = service.claim(player.getId(), claim.getToken());

        assertThat(result.unlocked()).isTrue();
        assertThat(claim.getStatus()).isEqualTo(ClaimStatus.CLAIMED);
        assertThat(claim.getClaimedBy()).isEqualTo(player);
        assertThat(claim.getClaimedAt()).isNotNull();
        verify(collectionService).discover(eq(player.getId()), eq(blackLotus.getId()), eq(ClaimService.physicalUuidFor(claim.getToken())));
        verify(claimRepository).save(claim);
    }

    @Test
    void secondClaimOnUniqueTokenIsRejectedWithConflict() {
        Claim claim = activeClaim(blackLotus);
        claim.setClaimedBy(player);
        when(claimRepository.findByTokenCoreForUpdate(claim.getToken())).thenReturn(Optional.of(claim));

        assertThatThrownBy(() -> service.claim(player.getId(), claim.getToken()))
                .isInstanceOf(ClaimException.class)
                .satisfies(e -> assertThat(((ClaimException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT));
        verify(collectionService, never()).discover(any(UUID.class), any(UUID.class));
    }

    @Test
    void expiredTokenIsRejectedAndMarkedExpired() {
        Claim claim = activeClaim(counterspell);
        claim.setExpiresAt(LocalDateTime.now().minusDays(1));
        when(claimRepository.findByTokenCoreForUpdate(claim.getToken())).thenReturn(Optional.of(claim));

        assertThatThrownBy(() -> service.claim(player.getId(), claim.getToken()))
                .isInstanceOf(ClaimException.class)
                .satisfies(e -> assertThat(((ClaimException) e).getStatus()).isEqualTo(HttpStatus.GONE));
        assertThat(claim.getStatus()).isEqualTo(ClaimStatus.EXPIRED);
        verify(claimRepository).save(claim);
        verify(collectionService, never()).discover(any(UUID.class), any(UUID.class));
    }

    @Test
    void revokedTokenIsRejected() {
        Claim claim = activeClaim(counterspell);
        claim.setStatus(ClaimStatus.REVOKED);
        when(claimRepository.findByTokenCoreForUpdate(claim.getToken())).thenReturn(Optional.of(claim));

        assertThatThrownBy(() -> service.claim(player.getId(), claim.getToken()))
                .isInstanceOf(ClaimException.class)
                .satisfies(e -> assertThat(((ClaimException) e).getStatus()).isEqualTo(HttpStatus.GONE));
        verify(collectionService, never()).discover(any(UUID.class), any(UUID.class));
    }

    @Test
    void unknownTokenIsNotFound() {
        when(claimRepository.findByTokenCoreForUpdate("NOPE")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.claim(player.getId(), "NOPE"))
                .isInstanceOf(ClaimException.class)
                .satisfies(e -> assertThat(((ClaimException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void signedTokenClaimsByCore() {
        Claim claim = activeClaim(counterspell);
        when(claimRepository.findByTokenCoreForUpdate("UNLOCKTOKEN123")).thenReturn(Optional.of(claim));
        when(collectionService.discover(player.getId(), counterspell.getId()))
                .thenReturn(DiscoverResultDto.unlocked(counterspell, 1, CollectionService.XP_PER_UNLOCK));

        ClaimResultDto result = service.claim(player.getId(), signer.sign("UNLOCKTOKEN123"));

        assertThat(result.unlocked()).isTrue();
        assertThat(result.token()).isEqualTo(claim.getToken());
        verify(claimRepository).findByTokenCoreForUpdate("UNLOCKTOKEN123");
    }

    @Test
    void forgedSignedTokenIsRejectedWithoutDbLookup() {
        String forged = "V1.UNLOCKTOKEN123." + "A".repeat(64);

        assertThatThrownBy(() -> service.claim(player.getId(), forged))
                .isInstanceOf(ClaimException.class)
                .satisfies(e -> assertThat(((ClaimException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        verify(claimRepository, never()).findByTokenCoreForUpdate(any(String.class));
    }

    @Test
    void tamperedSignedTokenIsRejected() {
        String signed = signer.sign("UNLOCKTOKEN123");
        String tampered = signed.substring(0, signed.length() - 1) + "F";

        assertThatThrownBy(() -> service.claim(player.getId(), tampered))
                .isInstanceOf(ClaimException.class)
                .satisfies(e -> assertThat(((ClaimException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        verify(claimRepository, never()).findByTokenCoreForUpdate(any(String.class));
    }

    @Test
    void mintReturnsSignedPayloadTokens() {
        when(cardRepository.findById(counterspell.getId())).thenReturn(Optional.of(counterspell));
        when(claimRepository.existsByTokenCore(any(String.class))).thenReturn(false);
        when(claimRepository.save(any(Claim.class))).thenAnswer(inv -> inv.getArgument(0));

        var minted = service.mint(new MintClaimRequest(counterspell.getId(), "Building B", null, 2, null), admin);

        assertThat(minted).hasSize(2);
        assertThat(minted).extracting(ClaimDto::token).allMatch(t -> {
            String core = signer.verify(t);
            return core != null && t.startsWith("V1.");
        });
    }

    @Test
    void mintCreatesUniqueTokensForCard() {
        when(cardRepository.findById(counterspell.getId())).thenReturn(Optional.of(counterspell));
        when(claimRepository.existsByTokenCore(any(String.class))).thenReturn(false);
        when(claimRepository.save(any(Claim.class))).thenAnswer(inv -> inv.getArgument(0));

        var minted = service.mint(new MintClaimRequest(counterspell.getId(), "Building B", null, 3, null), admin);

        assertThat(minted).hasSize(3);
        verify(claimRepository, times(3)).save(any(Claim.class));
        assertThat(minted).extracting(ClaimDto::token).doesNotHaveDuplicates();
        assertThat(minted).extracting(ClaimDto::status).containsOnly(ClaimStatus.ACTIVE);
        assertThat(minted).extracting(ClaimDto::spawnedBy).containsOnly("Admin");
        verify(publisher).publishEvent(any(com.campusforge.backend.common.events.SpawnEvent.class));
    }

    @Test
    void mintWithEventIdPersistsEventOnClaims() {
        when(cardRepository.findById(counterspell.getId())).thenReturn(Optional.of(counterspell));
        when(claimRepository.existsByTokenCore(any(String.class))).thenReturn(false);
        when(claimRepository.save(any(Claim.class))).thenAnswer(inv -> inv.getArgument(0));
        com.campusforge.backend.events.Event event =
                new com.campusforge.backend.events.Event("Campus Cup", java.util.List.of("M19"),
                        java.math.BigDecimal.ONE, LocalDateTime.now().minusDays(1), LocalDateTime.now().plusDays(1));
        event.setId(UUID.randomUUID());
        when(eventService.require(event.getId())).thenReturn(event);

        var minted = service.mint(new MintClaimRequest(counterspell.getId(), "Building B", null, 1, event.getId()), admin);

        assertThat(minted).hasSize(1);
        assertThat(minted.get(0).eventId()).isEqualTo(event.getId());
        assertThat(minted.get(0).eventName()).isEqualTo("Campus Cup");
    }

    @Test
    void physicalUuidForIsDeterministic() {
        assertThat(ClaimService.physicalUuidFor("TOKEN-A")).isEqualTo(ClaimService.physicalUuidFor("TOKEN-A"));
        assertThat(ClaimService.physicalUuidFor("TOKEN-A")).isNotEqualTo(ClaimService.physicalUuidFor("TOKEN-B"));
    }
}
