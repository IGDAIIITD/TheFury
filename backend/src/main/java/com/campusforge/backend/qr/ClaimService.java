package com.campusforge.backend.qr;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.collection.CollectionService;
import com.campusforge.backend.collection.OwnershipType;
import com.campusforge.backend.collection.dto.DiscoverResultDto;
import com.campusforge.backend.common.ResourceNotFoundException;
import com.campusforge.backend.common.events.SpawnEvent;
import com.campusforge.backend.events.Event;
import com.campusforge.backend.events.EventService;
import com.campusforge.backend.qr.dto.ClaimDto;
import com.campusforge.backend.qr.dto.ClaimResultDto;
import com.campusforge.backend.qr.dto.MintClaimRequest;
import com.campusforge.backend.qr.dto.QrPrintEntry;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class ClaimService {

    private static final String TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final int TOKEN_LENGTH = 12;
    private static final String UNIQUE_NAMESPACE = "cf-unique:";
    private static final int MAX_MINT_QUANTITY = 100;
    private static final SecureRandom random = new SecureRandom();

    private final ClaimRepository claimRepository;
    private final CollectionService collectionService;
    private final PlayerRepository playerRepository;
    private final CardRepository cardRepository;
    private final EventService eventService;
    private final QrCodeSigner qrCodeSigner;
    private final ApplicationEventPublisher publisher;

    public ClaimService(ClaimRepository claimRepository,
                        CollectionService collectionService,
                        PlayerRepository playerRepository,
                        CardRepository cardRepository,
                        EventService eventService,
                        QrCodeSigner qrCodeSigner,
                        ApplicationEventPublisher publisher) {
        this.claimRepository = claimRepository;
        this.collectionService = collectionService;
        this.playerRepository = playerRepository;
        this.cardRepository = cardRepository;
        this.eventService = eventService;
        this.qrCodeSigner = qrCodeSigner;
        this.publisher = publisher;
    }

    /**
     * Claims a QR token for the given player.
     *
     * <p>UNLOCK tokens stay active until expiry and are reusable per player (the
     * existing discovery/unlock dedupe prevents double unlocks). UNIQUE tokens are
     * one-shot: the first player to claim owns the serialized card; anyone else is
     * rejected with a conflict. A pessimistic row lock serializes concurrent claims
     * on the same token.
     *
     * <p>Signed payloads {@code V1.<CORE>.<SIG>} are verified (constant-time HMAC)
     * before any database lookup; bare cores are accepted for legacy tokens minted
     * before signing.
     */
    @Transactional
    public ClaimResultDto claim(UUID playerId, String token) {
        String normalized = token.trim().toUpperCase();
        String core;
        if (normalized.indexOf('.') >= 0) {
            core = qrCodeSigner.verify(normalized);
            if (core == null) {
                throw new ClaimException(HttpStatus.BAD_REQUEST, "Invalid or forged claim token");
            }
        } else {
            core = normalized;
        }

        Claim claim = claimRepository.findByTokenCoreForUpdate(core)
                .orElseThrow(() -> new ClaimException(HttpStatus.NOT_FOUND, "Claim token not found: " + token));

        if (claim.getStatus() == ClaimStatus.REVOKED) {
            throw new ClaimException(HttpStatus.GONE, "Claim token has been revoked");
        }
        if (claim.getExpiresAt() != null && claim.getExpiresAt().isBefore(LocalDateTime.now())) {
            claim.setStatus(ClaimStatus.EXPIRED);
            claimRepository.save(claim);
            throw new ClaimException(HttpStatus.GONE, "Claim token has expired");
        }
        if (claim.getCard().getOwnershipType() == OwnershipType.UNIQUE && claim.getClaimedBy() != null) {
            throw new ClaimException(HttpStatus.CONFLICT, "This unique card has already been claimed");
        }
        if (claim.getStatus() != ClaimStatus.ACTIVE) {
            throw new ClaimException(HttpStatus.GONE, "Claim token is no longer active");
        }

        if (claim.getCard().getOwnershipType() == OwnershipType.UNIQUE) {
            DiscoverResultDto result = collectionService.discover(playerId, claim.getCard().getId(), physicalUuidFor(core));
            claim.setStatus(ClaimStatus.CLAIMED);
            claim.setClaimedBy(playerRepository.getReferenceById(playerId));
            claim.setClaimedAt(LocalDateTime.now());
            claimRepository.save(claim);
            return ClaimResultDto.from(result, claim.getToken(), claim.getBuilding());
        }

        DiscoverResultDto result = collectionService.discover(playerId, claim.getCard().getId());
        claim.setClaimedBy(playerRepository.getReferenceById(playerId));
        claim.setClaimedAt(LocalDateTime.now());
        claimRepository.save(claim);
        return ClaimResultDto.from(result, claim.getToken(), claim.getBuilding());
    }

    @Transactional
    public List<ClaimDto> mint(MintClaimRequest request, Player admin) {
        Card card = cardRepository.findById(request.cardId())
                .orElseThrow(() -> new ResourceNotFoundException("Card not found: " + request.cardId()));
        int quantity = request.resolvedQuantity();
        if (quantity > MAX_MINT_QUANTITY) {
            throw new IllegalArgumentException("quantity must not exceed " + MAX_MINT_QUANTITY);
        }
        Event event = request.eventId() != null ? eventService.require(request.eventId()) : null;

        List<ClaimDto> minted = new ArrayList<>(quantity);
        for (int i = 0; i < quantity; i++) {
            String core = uniqueToken();
            Claim claim = claimRepository.save(
                    new Claim(qrCodeSigner.sign(core), core, card, request.building(), request.expiresAt()));
            claim.setEvent(event);
            claim.setSpawnedBy(admin);
            minted.add(ClaimDto.from(claim));
        }
        publisher.publishEvent(new SpawnEvent(
                admin.getDisplayName(), card.getForgeName(), request.building(), quantity));
        return minted;
    }

    @Transactional(readOnly = true)
    public List<ClaimDto> list(ClaimStatus status) {
        List<Claim> claims = status == null ? claimRepository.findAll() : claimRepository.findByStatus(status);
        return claims.stream().map(ClaimDto::from).toList();
    }

    /**
     * A token physically identifies a unique card: the QR text deterministically
     * maps to the {@code unique_cards.physical_uuid} so a single serialized copy
     * can never be duplicated across tokens.
     */
    public static UUID physicalUuidFor(String token) {
        return UUID.nameUUIDFromBytes((UNIQUE_NAMESPACE + token).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Generates a deterministic QR print catalog for every card in the catalog.
     * Each card always maps to the same token core (derived from its ID), so
     * re-running produces identical codes. New cards automatically get entries.
     */
    @Transactional
    public List<QrPrintEntry> generatePrintCatalog() {
        List<Card> cards = cardRepository.findAll();
        List<QrPrintEntry> entries = new ArrayList<>(cards.size());
        for (Card card : cards) {
            String core = deterministicCore(card.getId());
            Claim claim = claimRepository.findByTokenCore(core).orElse(null);
            if (claim == null) {
                String signedToken = qrCodeSigner.sign(core);
                claim = claimRepository.save(new Claim(signedToken, core, card, null, null));
            }
            entries.add(new QrPrintEntry(
                    card.getForgeName(),
                    card.getOracleId(),
                    core,
                    claim.getToken(),
                    card.getOwnershipType().name(),
                    card.getRarity()));
        }
        entries.sort((a, b) -> a.cardName().compareToIgnoreCase(b.cardName()));
        return entries;
    }

    private String uniqueToken() {
        for (int attempt = 0; attempt < 10; attempt++) {
            StringBuilder sb = new StringBuilder(TOKEN_LENGTH);
            for (int i = 0; i < TOKEN_LENGTH; i++) {
                sb.append(TOKEN_ALPHABET.charAt(random.nextInt(TOKEN_ALPHABET.length())));
            }
            String token = sb.toString();
            if (!claimRepository.existsByTokenCore(token)) {
                return token;
            }
        }
        throw new IllegalStateException("Could not allocate a unique claim token");
    }

    static String deterministicCore(UUID cardId) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(("cf-print:" + cardId).getBytes(StandardCharsets.UTF_8));
            long v = ((long) (digest[0] & 0xFF) << 40)
                    | ((long) (digest[1] & 0xFF) << 32)
                    | ((long) (digest[2] & 0xFF) << 24)
                    | ((long) (digest[3] & 0xFF) << 16)
                    | ((long) (digest[4] & 0xFF) << 8)
                    | (digest[5] & 0xFF);
            StringBuilder sb = new StringBuilder(TOKEN_LENGTH);
            for (int i = 0; i < TOKEN_LENGTH; i++) {
                sb.append(TOKEN_ALPHABET.charAt((int) (v % TOKEN_ALPHABET.length())));
                v /= TOKEN_ALPHABET.length();
            }
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
