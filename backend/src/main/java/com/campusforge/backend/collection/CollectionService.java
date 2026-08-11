package com.campusforge.backend.collection;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.dto.CollectionEntryDto;
import com.campusforge.backend.collection.dto.CollectionResponse;
import com.campusforge.backend.collection.dto.DiscoverResultDto;
import com.campusforge.backend.common.LevelService;
import com.campusforge.backend.common.ResourceNotFoundException;
import com.campusforge.backend.common.events.CardDiscoveredEvent;
import com.campusforge.backend.events.Event;
import com.campusforge.backend.events.EventService;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class CollectionService {

    public static final int UNLIMITED_QUANTITY = Integer.MAX_VALUE;
    public static final long XP_PER_UNLOCK = 10;

    private final PlayerRepository playerRepository;
    private final CardRepository cardRepository;
    private final PlayerUnlockRepository unlockRepository;
    private final UniqueCardRepository uniqueCardRepository;
    private final DiscoveryRepository discoveryRepository;
    private final FavoriteRepository favoriteRepository;
    private final EventService eventService;
    private final ApplicationEventPublisher publisher;

    public CollectionService(PlayerRepository playerRepository,
                             CardRepository cardRepository,
                             PlayerUnlockRepository unlockRepository,
                             UniqueCardRepository uniqueCardRepository,
                             DiscoveryRepository discoveryRepository,
                             FavoriteRepository favoriteRepository,
                             EventService eventService,
                             ApplicationEventPublisher publisher) {
        this.playerRepository = playerRepository;
        this.cardRepository = cardRepository;
        this.unlockRepository = unlockRepository;
        this.uniqueCardRepository = uniqueCardRepository;
        this.discoveryRepository = discoveryRepository;
        this.favoriteRepository = favoriteRepository;
        this.eventService = eventService;
        this.publisher = publisher;
    }

    @Transactional(readOnly = true)
    public CollectionResponse getCollection(UUID playerId) {
        Player player = requirePlayer(playerId);
        List<Card> cards = cardRepository.findAll();
        Map<UUID, Long> discoveryCounts = discoveryRepository.findByPlayer(player).stream()
                .collect(Collectors.toMap(d -> d.getCard().getId(), Discovery::getCount));
        Set<UUID> favorites = favoriteRepository.findByPlayer(player).stream()
                .map(f -> f.getCard().getId())
                .collect(Collectors.toSet());

        List<CollectionEntryDto> entries = new ArrayList<>();
        for (Card card : cards) {
            long quantity = quantity(player, card);
            if (quantity > 0) {
                long discovered = discoveryCounts.getOrDefault(card.getId(), 0L);
                boolean fav = favorites.contains(card.getId());
                entries.add(CollectionEntryDto.from(card, quantity, discovered, fav));
            }
        }
        entries.sort(Comparator.comparing(CollectionEntryDto::forgeName));
        return new CollectionResponse(entries, entries.size());
    }

    @Transactional
    public boolean toggleFavorite(UUID playerId, UUID cardId) {
        Player player = requirePlayer(playerId);
        Card card = requireCard(cardId);
        Optional<Favorite> existing = favoriteRepository.findByPlayerAndCard(player, card);
        if (existing.isPresent()) {
            favoriteRepository.delete(existing.get());
            return false;
        } else {
            favoriteRepository.save(new Favorite(player, card));
            return true;
        }
    }

    @Transactional(readOnly = true)
    public boolean owns(UUID playerId, UUID cardId) {
        Player player = requirePlayer(playerId);
        Card card = requireCard(cardId);
        return owns(player, card);
    }

    @Transactional(readOnly = true)
    public long quantity(UUID playerId, UUID cardId) {
        Player player = requirePlayer(playerId);
        Card card = requireCard(cardId);
        return quantity(player, card);
    }

    @Transactional(readOnly = true)
    public long discoveryCount(UUID playerId, UUID cardId) {
        Player player = requirePlayer(playerId);
        Card card = requireCard(cardId);
        return discoveryRepository.findByPlayerAndCard(player, card)
                .map(Discovery::getCount)
                .orElse(0L);
    }

    @Transactional
    public DiscoverResultDto discover(UUID playerId, UUID cardId) {
        return discover(playerId, cardId, UUID.randomUUID());
    }

    /**
     * {@code physicalUuid} binds the physical identity of a UNIQUE card so a QR
     * token maps to exactly one serialized copy. Ignored for other ownership types.
     */
    @Transactional
    public DiscoverResultDto discover(UUID playerId, UUID cardId, UUID physicalUuid) {
        Player player = requirePlayer(playerId);
        Card card = requireCard(cardId);
        Event activeEvent = eventService.activeEvent(LocalDateTime.now());

        Discovery discovery = discoveryRepository.findByPlayerAndCard(player, card)
                .orElseGet(() -> new Discovery(player, card));
        if (discovery.getId() != null) {
            discovery.setCount(discovery.getCount() + 1);
        }
        discovery.setLastDiscovered(java.time.LocalDateTime.now());
        discoveryRepository.save(discovery);

        if (owns(player, card)) {
            publisher.publishEvent(new CardDiscoveredEvent(playerId, player.getDisplayName(),
                    card.getForgeName(), false, 0));
            return DiscoverResultDto.alreadyOwned(card, discovery.getCount());
        }

        switch (card.getOwnershipType()) {
            case UNLIMITED -> {
                publisher.publishEvent(new CardDiscoveredEvent(playerId, player.getDisplayName(),
                        card.getForgeName(), false, 0));
                return DiscoverResultDto.alreadyOwned(card, discovery.getCount());
            }
            case UNLOCK -> unlock(player, card);
            case UNIQUE -> {
                int serial = uniqueCardRepository.maxSerialNumberByCard(card) + 1;
                uniqueCardRepository.save(new UniqueCard(physicalUuid, player, card, serial, "claimed via discovery"));
            }
            default -> throw new IllegalStateException("Unknown ownership type: " + card.getOwnershipType());
        }

        long xp = applyEventBonus(XP_PER_UNLOCK, activeEvent);
        player.setExperience(player.getExperience() + xp);
        player.setLevel(LevelService.levelFor(player.getExperience()));
        playerRepository.save(player);
        publisher.publishEvent(new CardDiscoveredEvent(playerId, player.getDisplayName(),
                card.getForgeName(), true, xp));
        return DiscoverResultDto.unlocked(card, discovery.getCount(), xp);
    }

    private long applyEventBonus(long base, Event event) {
        if (event == null) {
            return base;
        }
        return Math.round(base * event.getBonusMultiplier().doubleValue());
    }

    private void unlock(Player player, Card card) {
        if (!unlockRepository.existsByPlayerAndCard(player, card)) {
            unlockRepository.save(new PlayerUnlock(player, card));
        }
    }

    private boolean owns(Player player, Card card) {
        return switch (card.getOwnershipType()) {
            case UNLIMITED -> true;
            case UNLOCK -> unlockRepository.existsByPlayerAndCard(player, card);
            case UNIQUE -> uniqueCardRepository.findByOwner(player).stream()
                    .anyMatch(uc -> uc.getCard().getId().equals(card.getId()));
        };
    }

    private long quantity(Player player, Card card) {
        return switch (card.getOwnershipType()) {
            case UNLIMITED -> UNLIMITED_QUANTITY;
            case UNLOCK -> unlockRepository.findByPlayer(player).stream()
                    .filter(u -> u.getCard().getId().equals(card.getId())).count();
            case UNIQUE -> uniqueCardRepository.findByOwner(player).stream()
                    .filter(uc -> uc.getCard().getId().equals(card.getId())).count();
        };
    }

    private Player requirePlayer(UUID playerId) {
        return playerRepository.findById(playerId)
                .orElseThrow(() -> new ResourceNotFoundException("Player not found: " + playerId));
    }

    private Card requireCard(UUID cardId) {
        return cardRepository.findById(cardId)
                .orElseThrow(() -> new ResourceNotFoundException("Card not found: " + cardId));
    }
}
