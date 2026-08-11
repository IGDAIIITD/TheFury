package com.campusforge.backend.deck;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.collection.CollectionService;
import com.campusforge.backend.collection.OwnershipType;
import com.campusforge.backend.collection.PlayerUnlock;
import com.campusforge.backend.collection.PlayerUnlockRepository;
import com.campusforge.backend.collection.UniqueCardRepository;
import com.campusforge.backend.collection.DiscoveryRepository;
import com.campusforge.backend.collection.FavoriteRepository;
import com.campusforge.backend.deck.dto.DeckCardRequest;
import com.campusforge.backend.deck.dto.ValidateDeckRequest;
import com.campusforge.backend.events.Event;
import com.campusforge.backend.events.EventService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DeckValidationServiceTest {

    @Mock
    FormatRepository formatRepository;
    @Mock
    CardRepository cardRepository;
    @Mock
    CardLegalityRepository legalityRepository;
    @Mock
    PlayerRepository playerRepository;
    @Mock
    PlayerUnlockRepository unlockRepository;
    @Mock
    UniqueCardRepository uniqueCardRepository;
    @Mock
    DiscoveryRepository discoveryRepository;
    @Mock
    FavoriteRepository favoriteRepository;
    @Mock
    EventService eventService;
    @Mock
    ApplicationEventPublisher publisher;

    DeckValidationService service;
    CollectionService collectionService;

    Player player;
    Format standard;
    Format commander;
    Card island;
    Card mountain;
    Card counterspell;
    Card blackLotus;
    Card solemm;

    @BeforeEach
    void setUp() {
        collectionService = new CollectionService(playerRepository, cardRepository, unlockRepository,
                uniqueCardRepository, discoveryRepository, favoriteRepository, eventService, publisher);
        service = new DeckValidationService(formatRepository, cardRepository, legalityRepository, collectionService);

        player = new Player();
        player.setId(UUID.randomUUID());

        standard = new Format("STANDARD", "Standard", 4, 60, null, false, true);
        commander = new Format("COMMANDER", "Commander", 1, 99, 99, true, true);

        island = new Card("oracle-island", "Island", "Common", OwnershipType.UNLIMITED,
                "M19", 0, "Basic Land — Island", "U", null, true, "Library", 10.0);
        mountain = new Card("oracle-mountain", "Mountain", "Common", OwnershipType.UNLIMITED,
                "M19", 0, "Basic Land — Mountain", "R", null, true, "Library", 10.0);
        counterspell = new Card("oracle-counterspell", "Counterspell", "Common", OwnershipType.UNLOCK,
                "M19", 2, "Instant", "U", null, true, "Building B", 5.0);
        blackLotus = new Card("oracle-lotus", "Black Lotus", "Mythic", OwnershipType.UNIQUE,
                "LEA", 0, "Artifact", "", null, false, "Special", 0.1);
        solemm = new Card("oracle-solemn", "Solemn Simulacrum", "Rare", OwnershipType.UNLOCK,
                "M19", 4, "Artifact Creature — Golem", "", null, true, "Engineering", 2.0);

        List<Card> cards = List.of(island, mountain, counterspell, blackLotus, solemm);
        lenient().when(cardRepository.findById(any())).thenReturn(Optional.empty());
        for (Card c : cards) {
            c.setId(UUID.randomUUID());
            lenient().when(cardRepository.findById(c.getId())).thenReturn(Optional.of(c));
        }
        lenient().when(playerRepository.findById(player.getId())).thenReturn(Optional.of(player));

        // owns() via collection: unlock cards owned when a PlayerUnlock exists; unlimited always owned
        lenient().when(unlockRepository.findByPlayer(player)).thenReturn(List.of(
                new PlayerUnlock(player, counterspell),
                new PlayerUnlock(player, solemm)));
        lenient().when(unlockRepository.existsByPlayerAndCard(eq(player), eq(counterspell))).thenReturn(true);
        lenient().when(unlockRepository.existsByPlayerAndCard(eq(player), eq(solemm))).thenReturn(true);
        lenient().when(uniqueCardRepository.findByOwner(player)).thenReturn(List.of());

        lenient().when(formatRepository.findByCode("STANDARD")).thenReturn(Optional.of(standard));
        lenient().when(formatRepository.findByCode("COMMANDER")).thenReturn(Optional.of(commander));
        lenient().when(legalityRepository.findByFormatId(any())).thenReturn(List.of());
    }

    private ValidateDeckRequest request(String formatCode, UUID commanderCardId, DeckCardRequest... cards) {
        return new ValidateDeckRequest(formatCode, commanderCardId, List.of(cards));
    }

    private DeckCardRequest card(Card c, int qty) {
        return new DeckCardRequest(c.getId(), qty);
    }

    @Test
    void validStandardDeckWithCopiesAndLands() {
        ValidateDeckRequest req = request("STANDARD", null,
                card(island, 30), card(counterspell, 1),
                card(mountain, 28), card(solemm, 1));

        DeckValidationService.DeckValidation result = service.validate(player, req);

        assertThat(result.valid()).isTrue();
    }

    @Test
    void unownedCardIsRejected() {
        // Black Lotus is not in the unlocked/unique lists -> not owned
        ValidateDeckRequest req = request("STANDARD", null,
                card(island, 30), card(mountain, 30), card(blackLotus, 1));

        DeckValidationService.DeckValidation result = service.validate(player, req);

        assertThat(result.valid()).isFalse();
        assertThat(result.problems()).anyMatch(p -> p.code().equals("NOT_OWNED"));
    }

    @Test
    void exceedingFourCopiesInStandardIsRejected() {
        ValidateDeckRequest req = request("STANDARD", null,
                card(island, 20), card(mountain, 20), card(solemm, 5));

        DeckValidationService.DeckValidation result = service.validate(player, req);

        assertThat(result.valid()).isFalse();
        assertThat(result.problems()).anyMatch(p -> p.code().equals("TOO_MANY_COPIES"));
    }

    @Test
    void basicLandsAreNotSubjectToCopyLimit() {
        ValidateDeckRequest req = request("STANDARD", null, card(island, 40), card(mountain, 40));

        DeckValidationService.DeckValidation result = service.validate(player, req);

        assertThat(result.valid()).isTrue();
        assertThat(result.problems()).noneMatch(p -> p.code().equals("TOO_MANY_COPIES"));
    }

    @Test
    void bannedCardInStandardIsRejected() {
        when(legalityRepository.findByFormatId(standard.getId())).thenReturn(List.of(
                new CardLegality(blackLotus, standard, Legality.BANNED)));
        // ensure Black Lotus passes ownership so only the ban triggers
        lenient().when(uniqueCardRepository.findByOwner(player)).thenReturn(List.of(
                new com.campusforge.backend.collection.UniqueCard(
                        UUID.randomUUID(), player, blackLotus, 1, "claimed")));

        ValidateDeckRequest req = request("STANDARD", null,
                card(island, 20), card(mountain, 20), card(blackLotus, 1));

        DeckValidationService.DeckValidation result = service.validate(player, req);

        assertThat(result.valid()).isFalse();
        assertThat(result.problems()).anyMatch(p -> p.code().equals("BANNED"));
    }

    @Test
    void commanderRequiresLegendaryEligibleCommander() {
        solemm.setCommanderEligible(true);
        ValidateDeckRequest req = request("COMMANDER", counterspell.getId(),
                card(island, 30), card(mountain, 30), card(solemm, 1));

        DeckValidationService.DeckValidation result = service.validate(player, req);

        assertThat(result.valid()).isFalse();
        assertThat(result.problems()).anyMatch(p -> p.code().equals("NOT_LEGENDARY"));
    }

    @Test
    void commanderColorIdentityViolationIsRejected() {
        solemm.setCommanderEligible(true);
        ValidateDeckRequest req = request("COMMANDER", solemm.getId(),
                card(island, 30), card(mountain, 30), card(counterspell, 1));

        DeckValidationService.DeckValidation result = service.validate(player, req);

        assertThat(result.valid()).isFalse();
        assertThat(result.problems()).anyMatch(p -> p.code().equals("COLOR_IDENTITY"));
    }

    @Test
    void commanderSizeLimitRejectsTooManyCards() {
        solemm.setCommanderEligible(true);
        ValidateDeckRequest req = request("COMMANDER", solemm.getId(),
                card(island, 40), card(mountain, 40), card(solemm, 20));

        DeckValidationService.DeckValidation result = service.validate(player, req);

        assertThat(result.valid()).isFalse();
        assertThat(result.problems()).anyMatch(p -> p.code().equals("TOO_MANY_CARDS"));
    }

    @Test
    void missingCommanderIsRejected() {
        ValidateDeckRequest req = request("COMMANDER", null,
                card(island, 40), card(mountain, 40), card(solemm, 1));

        DeckValidationService.DeckValidation result = service.validate(player, req);

        assertThat(result.valid()).isFalse();
        assertThat(result.problems()).anyMatch(p -> p.code().equals("NO_COMMANDER"));
    }

    @Test
    void unknownFormatIsRejected() {
        when(formatRepository.findByCode("CUSTOM")).thenReturn(Optional.empty());

        ValidateDeckRequest req = request("CUSTOM", null, card(island, 60));

        DeckValidationService.DeckValidation result = service.validate(player, req);

        assertThat(result.valid()).isFalse();
        assertThat(result.problems()).anyMatch(p -> p.code().equals("UNKNOWN_FORMAT"));
    }

    private Event event(List<String> allowedSets) {
        Event event = new Event("Campus Cup", allowedSets, BigDecimal.ONE,
                LocalDateTime.now().minusDays(1), LocalDateTime.now().plusDays(1));
        event.setId(UUID.randomUUID());
        return event;
    }

    @Test
    void offSetNonBasicCardIsRejectedWithNotInEvent() {
        Event event = event(List.of("LEA"));
        ValidateDeckRequest req = request("STANDARD", null,
                card(island, 30), card(mountain, 28), card(counterspell, 1), card(solemm, 1));

        DeckValidationService.DeckValidation result = service.validate(player, req, event);

        assertThat(result.valid()).isFalse();
        assertThat(result.problems()).anyMatch(p -> p.code().equals("NOT_IN_EVENT"));
    }

    @Test
    void basicLandsAreExemptFromEventSetRestriction() {
        Event event = event(List.of("LEA"));
        ValidateDeckRequest req = request("STANDARD", null, card(island, 40), card(mountain, 40));

        DeckValidationService.DeckValidation result = service.validate(player, req, event);

        assertThat(result.valid()).isTrue();
    }

    @Test
    void onSetDeckPassesEventValidation() {
        Event event = event(List.of("M19"));
        ValidateDeckRequest req = request("STANDARD", null,
                card(island, 30), card(mountain, 28), card(counterspell, 1), card(solemm, 1));

        DeckValidationService.DeckValidation result = service.validate(player, req, event);

        assertThat(result.valid()).isTrue();
    }

    @Test
    void nullEventDelegatesToBaseValidation() {
        ValidateDeckRequest req = request("STANDARD", null,
                card(island, 30), card(mountain, 28), card(counterspell, 1), card(solemm, 1));

        DeckValidationService.DeckValidation result = service.validate(player, req, null);

        assertThat(result.valid()).isTrue();
    }
}
