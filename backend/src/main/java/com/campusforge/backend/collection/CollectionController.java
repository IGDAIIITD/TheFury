package com.campusforge.backend.collection;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.dto.CardDto;
import com.campusforge.backend.collection.dto.CollectionEntryDto;
import com.campusforge.backend.collection.dto.CollectionResponse;
import com.campusforge.backend.collection.dto.DiscoverResultDto;
import com.campusforge.backend.collection.dto.UniqueCardDto;
import com.campusforge.backend.security.PlayerPrincipal;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class CollectionController {

    private final CollectionService collectionService;
    private final CardRepository cardRepository;
    private final PlayerRepository playerRepository;
    private final FavoriteRepository favoriteRepository;
    private final UniqueCardRepository uniqueCardRepository;

    public CollectionController(CollectionService collectionService,
                                CardRepository cardRepository,
                                PlayerRepository playerRepository,
                                FavoriteRepository favoriteRepository,
                                UniqueCardRepository uniqueCardRepository) {
        this.collectionService = collectionService;
        this.cardRepository = cardRepository;
        this.playerRepository = playerRepository;
        this.favoriteRepository = favoriteRepository;
        this.uniqueCardRepository = uniqueCardRepository;
    }

    @GetMapping("/cards")
    public List<CardDto> browseCards(@RequestParam(required = false) String name,
                                     @RequestParam(required = false) OwnershipType ownershipType) {
        List<Card> cards;
        if (name != null && !name.isBlank()) {
            cards = cardRepository.findByForgeNameContainingIgnoreCase(name.trim());
        } else if (ownershipType != null) {
            cards = cardRepository.findByOwnershipType(ownershipType);
        } else {
            cards = cardRepository.findAll();
        }
        return cards.stream().map(CardDto::from).toList();
    }

    @GetMapping("/collection")
    public CollectionResponse getCollection(@AuthenticationPrincipal PlayerPrincipal principal) {
        return collectionService.getCollection(principal.getPlayer().getId());
    }

    @GetMapping("/collection/unique")
    public List<UniqueCardDto> getUniqueCards(@AuthenticationPrincipal PlayerPrincipal principal) {
        return uniqueCardRepository.findByOwner(principal.getPlayer()).stream()
                .map(UniqueCardDto::from)
                .toList();
    }

    @GetMapping("/collection/cards/{cardId}")
    public CollectionEntryDto getCardOwnership(@AuthenticationPrincipal PlayerPrincipal principal,
                                                @PathVariable UUID cardId) {
        UUID playerId = principal.getPlayer().getId();
        long quantity = collectionService.quantity(playerId, cardId);
        long discovered = collectionService.discoveryCount(playerId, cardId);
        Card card = cardRepository.findById(cardId)
                .orElseThrow(() -> new com.campusforge.backend.common.ResourceNotFoundException("Card not found: " + cardId));
        boolean fav = favoriteRepository.findByPlayerAndCard(principal.getPlayer(), card).isPresent();
        return CollectionEntryDto.from(card, quantity, discovered, fav);
    }

    @PostMapping("/collection/discover/{cardId}")
    public ResponseEntity<DiscoverResultDto> discover(@AuthenticationPrincipal PlayerPrincipal principal,
                                                      @PathVariable UUID cardId) {
        return ResponseEntity.ok(collectionService.discover(principal.getPlayer().getId(), cardId));
    }

    @org.springframework.web.bind.annotation.PutMapping("/collection/favorites/{cardId}")
    public ResponseEntity<java.util.Map<String, Boolean>> toggleFavorite(
            @AuthenticationPrincipal PlayerPrincipal principal,
            @PathVariable UUID cardId) {
        boolean favorite = collectionService.toggleFavorite(principal.getPlayer().getId(), cardId);
        return ResponseEntity.ok(java.util.Map.of("favorite", favorite));
    }
}
