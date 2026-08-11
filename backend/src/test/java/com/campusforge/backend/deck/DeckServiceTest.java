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
import com.campusforge.backend.common.ResourceNotFoundException;
import com.campusforge.backend.deck.dto.CreateDeckRequest;
import com.campusforge.backend.deck.DeckCard;
import com.campusforge.backend.deck.dto.DeckCardRequest;
import com.campusforge.backend.deck.dto.DeckDto;
import com.campusforge.backend.events.EventService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DeckServiceTest {

    @Mock
    DeckRepository deckRepository;
    @Mock
    PlayerRepository playerRepository;
    @Mock
    CardRepository cardRepository;
    @Mock
    PlayerUnlockRepository unlockRepository;
    @Mock
    UniqueCardRepository uniqueCardRepository;
    @Mock
    DiscoveryRepository discoveryRepository;
    @Mock
    FavoriteRepository favoriteRepository;
    @Mock
    FormatRepository formatRepository;
    @Mock
    CardLegalityRepository legalityRepository;
    @Mock
    EventService eventService;
    @Mock
    ApplicationEventPublisher publisher;

    DeckService service;

    Player player;
    Card island;

    @BeforeEach
    void setUp() {
        CollectionService collectionService = new CollectionService(playerRepository, cardRepository,
                unlockRepository, uniqueCardRepository, discoveryRepository, favoriteRepository,
                eventService, publisher);
        DeckValidationService validationService = new DeckValidationService(formatRepository, cardRepository,
                legalityRepository, collectionService);
        service = new DeckService(deckRepository, playerRepository, cardRepository, validationService);

        player = new Player();
        player.setId(UUID.randomUUID());
        island = new Card("oracle-island", "Island", "Common", OwnershipType.UNLIMITED,
                "M19", 0, "Basic Land — Island", "U", null, true, "Library", 10.0);
        island.setId(UUID.randomUUID());

        lenient().when(playerRepository.findById(player.getId())).thenReturn(Optional.of(player));
        lenient().when(cardRepository.findById(island.getId())).thenReturn(Optional.of(island));
        lenient().when(formatRepository.findByCode("STANDARD")).thenReturn(Optional.of(
                new Format("STANDARD", "Standard", 4, 60, null, false, true)));
        lenient().when(formatRepository.findByCode("COMMANDER")).thenReturn(Optional.of(
                new Format("COMMANDER", "Commander", 1, 99, 99, true, true)));
        lenient().when(legalityRepository.findByFormatId(any())).thenReturn(List.of());
    }

    @Test
    void createValidDeckPersistsSnapshot() {
        CreateDeckRequest req = new CreateDeckRequest("My Deck", "STANDARD", null,
                List.of(new DeckCardRequest(island.getId(), 60)));

        when(deckRepository.save(any(Deck.class))).thenAnswer(inv -> inv.getArgument(0));

        DeckDto result = service.create(player.getId(), req);

        assertThat(result.name()).isEqualTo("My Deck");
        assertThat(result.cards()).hasSize(1);
        assertThat(result.cards().get(0).quantity()).isEqualTo(60);
        verify(deckRepository).save(any(Deck.class));
    }

    @Test
    void createInvalidDeckThrows() {
        // UNIQUE card not owned -> validation fails
        Card lotus = new Card("oracle-lotus", "Black Lotus", "Mythic", OwnershipType.UNIQUE,
                "LEA", 0, "Artifact", "", null, false, "Special", 0.1);
        lotus.setId(UUID.randomUUID());
        lenient().when(cardRepository.findById(lotus.getId())).thenReturn(Optional.of(lotus));
        lenient().when(uniqueCardRepository.findByOwner(player)).thenReturn(List.of());

        CreateDeckRequest req = new CreateDeckRequest("Bad Deck", "STANDARD", null,
                List.of(new DeckCardRequest(lotus.getId(), 1)));

        assertThatThrownBy(() -> service.create(player.getId(), req))
                .isInstanceOf(InvalidDeckException.class);
        verify(deckRepository, never()).save(any(Deck.class));
    }

    @Test
    void updateExistingDeckPersistsChanges() {
        UUID deckId = UUID.randomUUID();
        Deck existingDeck = new Deck(player, "Old Deck", "STANDARD", null);
        existingDeck.setId(deckId);
        existingDeck.setCards(List.of(new DeckCard(existingDeck, island, 10)));
        when(deckRepository.findByIdAndPlayerId(deckId, player.getId())).thenReturn(Optional.of(existingDeck));
        when(deckRepository.save(any(Deck.class))).thenAnswer(inv -> inv.getArgument(0));

        CreateDeckRequest req = new CreateDeckRequest("Updated Deck", "STANDARD", null,
                List.of(new DeckCardRequest(island.getId(), 60)));

        DeckDto result = service.update(player.getId(), deckId, req);

        assertThat(result.name()).isEqualTo("Updated Deck");
        assertThat(result.cards()).hasSize(1);
        assertThat(result.cards().get(0).quantity()).isEqualTo(60);
        verify(deckRepository).save(any(Deck.class));
    }

    @Test
    void updateNonExistentDeckThrows404() {
        UUID deckId = UUID.randomUUID();
        when(deckRepository.findByIdAndPlayerId(deckId, player.getId())).thenReturn(Optional.empty());

        CreateDeckRequest req = new CreateDeckRequest("X", "STANDARD", null,
                List.of(new DeckCardRequest(island.getId(), 60)));

        assertThatThrownBy(() -> service.update(player.getId(), deckId, req))
                .isInstanceOf(ResourceNotFoundException.class);
    }
}
