package com.campusforge.backend.collection;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.dto.CollectionEntryDto;
import com.campusforge.backend.collection.dto.CollectionResponse;
import com.campusforge.backend.collection.dto.DiscoverResultDto;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CollectionServiceTest {

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
    EventService eventService;
    @Mock
    ApplicationEventPublisher publisher;

    CollectionService service;

    Player player;
    Card plains;
    Card counterspell;
    Card blackLotus;

    @BeforeEach
    void setUp() {
        service = new CollectionService(playerRepository, cardRepository, unlockRepository,
                uniqueCardRepository, discoveryRepository, favoriteRepository, eventService, publisher);

        player = new Player();
        player.setId(UUID.randomUUID());
        player.setEmail("tester@campus.edu");
        player.setDisplayName("Tester");

        plains = new Card("oracle-plains", "Plains", "Common", OwnershipType.UNLIMITED,
                "M19", 0, "Basic Land — Plains", "W", null, true, "Library", 10.0);
        counterspell = new Card("oracle-counter", "Counterspell", "Common", OwnershipType.UNLOCK,
                "M19", 2, "Instant", "U", null, true, "Building B", 5.0);
        blackLotus = new Card("oracle-lotus", "Black Lotus", "Mythic", OwnershipType.UNIQUE,
                "LEA", 0, "Artifact", "", null, false, "Special", 0.1);
        plains.setId(UUID.randomUUID());
        counterspell.setId(UUID.randomUUID());
        blackLotus.setId(UUID.randomUUID());

        when(playerRepository.findById(player.getId())).thenReturn(Optional.of(player));
    }

    @Test
    void unlimitedCardsAreAlwaysOwned() {
        when(cardRepository.findById(plains.getId())).thenReturn(Optional.of(plains));

        assertThat(service.owns(player.getId(), plains.getId())).isTrue();
        assertThat(service.quantity(player.getId(), plains.getId()))
                .isEqualTo(CollectionService.UNLIMITED_QUANTITY);
    }

    @Test
    void discoverUnlocksUnlockCardAndAwardsXp() {
        when(cardRepository.findById(counterspell.getId())).thenReturn(Optional.of(counterspell));
        when(discoveryRepository.findByPlayerAndCard(player, counterspell)).thenReturn(Optional.empty());
        when(unlockRepository.existsByPlayerAndCard(player, counterspell)).thenReturn(false);

        DiscoverResultDto result = service.discover(player.getId(), counterspell.getId());

        assertThat(result.unlocked()).isTrue();
        assertThat(result.alreadyOwned()).isFalse();
        assertThat(result.experienceAwarded()).isEqualTo(CollectionService.XP_PER_UNLOCK);
        assertThat(player.getExperience()).isEqualTo(CollectionService.XP_PER_UNLOCK);
        verify(unlockRepository).save(any(PlayerUnlock.class));
        verify(discoveryRepository).save(any(Discovery.class));
    }

    @Test
    void reDiscoveringOwnedCardIncrementsDiscoveryCountWithoutReUnlock() {
        when(cardRepository.findById(counterspell.getId())).thenReturn(Optional.of(counterspell));
        Discovery existing = new Discovery(player, counterspell);
        existing.setId(UUID.randomUUID());
        existing.setCount(1);
        when(discoveryRepository.findByPlayerAndCard(player, counterspell)).thenReturn(Optional.of(existing));
        when(unlockRepository.existsByPlayerAndCard(player, counterspell)).thenReturn(true);

        DiscoverResultDto result = service.discover(player.getId(), counterspell.getId());

        assertThat(result.unlocked()).isFalse();
        assertThat(result.alreadyOwned()).isTrue();
        assertThat(result.discoveryCount()).isEqualTo(2);
        assertThat(player.getExperience()).isZero();
        verify(unlockRepository, never()).save(any(PlayerUnlock.class));
    }

    @Test
    void discoverUniqueCardCreatesSerializedOwnership() {
        when(cardRepository.findById(blackLotus.getId())).thenReturn(Optional.of(blackLotus));
        when(discoveryRepository.findByPlayerAndCard(player, blackLotus)).thenReturn(Optional.empty());
        when(uniqueCardRepository.maxSerialNumberByCard(blackLotus)).thenReturn(0);

        DiscoverResultDto result = service.discover(player.getId(), blackLotus.getId());

        assertThat(result.unlocked()).isTrue();
        org.mockito.ArgumentCaptor<UniqueCard> captor =
                org.mockito.ArgumentCaptor.forClass(UniqueCard.class);
        verify(uniqueCardRepository).save(captor.capture());
        assertThat(captor.getValue().getSerialNumber()).isEqualTo(1);
        assertThat(captor.getValue().getOwner()).isEqualTo(player);
        verify(unlockRepository, never()).save(any(PlayerUnlock.class));
    }

    @Test
    void discoverUniqueCardUsesProvidedPhysicalUuid() {
        when(cardRepository.findById(blackLotus.getId())).thenReturn(Optional.of(blackLotus));
        when(discoveryRepository.findByPlayerAndCard(player, blackLotus)).thenReturn(Optional.empty());
        when(uniqueCardRepository.maxSerialNumberByCard(blackLotus)).thenReturn(0);
        UUID physicalUuid = UUID.nameUUIDFromBytes("cf-unique:ABCDEFGHJKLM".getBytes());

        DiscoverResultDto result = service.discover(player.getId(), blackLotus.getId(), physicalUuid);

        assertThat(result.unlocked()).isTrue();
        org.mockito.ArgumentCaptor<UniqueCard> captor =
                org.mockito.ArgumentCaptor.forClass(UniqueCard.class);
        verify(uniqueCardRepository).save(captor.capture());
        assertThat(captor.getValue().getPhysicalUuid()).isEqualTo(physicalUuid);
        assertThat(captor.getValue().getSerialNumber()).isEqualTo(1);
    }

    @Test
    void getCollectionIncludesOwnedAndUnlimitedOnly() {
        when(cardRepository.findAll()).thenReturn(List.of(plains, counterspell, blackLotus));
        when(discoveryRepository.findByPlayer(player)).thenReturn(List.of());
        when(favoriteRepository.findByPlayer(player)).thenReturn(List.of());
        when(unlockRepository.findByPlayer(player))
                .thenReturn(List.of(new PlayerUnlock(player, counterspell)));
        when(uniqueCardRepository.findByOwner(player)).thenReturn(List.of());

        CollectionResponse response = service.getCollection(player.getId());

        assertThat(response.entries()).hasSize(2);
        List<CollectionEntryDto> entries = response.entries();
        assertThat(entries).anyMatch(e -> e.forgeName().equals("Plains") && e.quantity() > 0);
        assertThat(entries).anyMatch(e -> e.forgeName().equals("Counterspell") && e.quantity() == 1);
        assertThat(entries).noneMatch(e -> e.forgeName().equals("Black Lotus"));
    }

    @Test
    void toggleFavoriteAddsAndRemovesFavorite() {
        when(cardRepository.findById(counterspell.getId())).thenReturn(Optional.of(counterspell));
        when(favoriteRepository.findByPlayerAndCard(player, counterspell)).thenReturn(Optional.empty());

        boolean added = service.toggleFavorite(player.getId(), counterspell.getId());
        assertThat(added).isTrue();
        verify(favoriteRepository).save(any(Favorite.class));

        Favorite fav = new Favorite(player, counterspell);
        when(favoriteRepository.findByPlayerAndCard(player, counterspell)).thenReturn(Optional.of(fav));

        boolean removed = service.toggleFavorite(player.getId(), counterspell.getId());
        assertThat(removed).isFalse();
        verify(favoriteRepository).delete(fav);
    }
}
