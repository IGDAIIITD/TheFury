package com.campusforge.backend.deck;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.common.ResourceNotFoundException;
import com.campusforge.backend.deck.dto.CreateDeckRequest;
import com.campusforge.backend.deck.dto.DeckCardRequest;
import com.campusforge.backend.deck.dto.DeckDto;
import com.campusforge.backend.deck.dto.DeckProblemDto;
import com.campusforge.backend.deck.dto.ValidateDeckRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class DeckService {

    private final DeckRepository deckRepository;
    private final PlayerRepository playerRepository;
    private final CardRepository cardRepository;
    private final DeckValidationService validationService;

    public DeckService(DeckRepository deckRepository,
                       PlayerRepository playerRepository,
                       CardRepository cardRepository,
                       DeckValidationService validationService) {
        this.deckRepository = deckRepository;
        this.playerRepository = playerRepository;
        this.cardRepository = cardRepository;
        this.validationService = validationService;
    }

    @Transactional(readOnly = true)
    public List<DeckDto> list(UUID playerId) {
        Player player = requirePlayer(playerId);
        return deckRepository.findByPlayerId(player.getId()).stream()
                .sorted((a, b) -> b.getUpdatedAt().compareTo(a.getUpdatedAt()))
                .map(DeckDto::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public DeckDto get(UUID playerId, UUID deckId) {
        return DeckDto.from(requireDeck(playerId, deckId));
    }

    @Transactional
    public DeckDto create(UUID playerId, CreateDeckRequest request) {
        Player player = requirePlayer(playerId);
        validateOrThrow(player, request.formatCode(), request.commanderCardId(), request.cards());

        Deck deck = new Deck(player, request.name(), request.formatCode(), resolveCard(request.commanderCardId()));
        applyCards(deck, request.cards());
        return DeckDto.from(deckRepository.save(deck));
    }

    @Transactional
    public DeckDto update(UUID playerId, UUID deckId, CreateDeckRequest request) {
        Player player = requirePlayer(playerId);
        Deck deck = requireDeck(playerId, deckId);
        validateOrThrow(player, request.formatCode(), request.commanderCardId(), request.cards());

        deck.setName(request.name());
        deck.setFormatCode(request.formatCode());
        deck.setCommander(resolveCard(request.commanderCardId()));
        deck.setUpdatedAt(LocalDateTime.now());
        applyCards(deck, request.cards());
        return DeckDto.from(deckRepository.save(deck));
    }

    @Transactional
    public void delete(UUID playerId, UUID deckId) {
        Deck deck = requireDeck(playerId, deckId);
        deckRepository.delete(deck);
    }

    @Transactional(readOnly = true)
    public DeckValidationService.DeckValidation validateDraft(UUID playerId, ValidateDeckRequest request) {
        Player player = requirePlayer(playerId);
        return validationService.validate(player, request);
    }

    private void validateOrThrow(Player player, String formatCode, UUID commanderCardId,
                                 List<DeckCardRequest> cards) {
        DeckValidationService.DeckValidation result =
                validationService.validate(player, new ValidateDeckRequest(formatCode, commanderCardId, cards));
        if (!result.valid()) {
            List<DeckProblemDto> problemDtos = result.problems().stream()
                    .map(p -> new DeckProblemDto(p.code(), p.message(), p.cardId()))
                    .toList();
            throw new InvalidDeckException(problemDtos);
        }
    }

    private void applyCards(Deck deck, List<DeckCardRequest> requests) {
        Map<UUID, Integer> quantities = requests.stream()
                .collect(Collectors.groupingBy(DeckCardRequest::cardId,
                        Collectors.summingInt(DeckCardRequest::quantity)));
        deck.setCards(quantities.entrySet().stream()
                .map(e -> new DeckCard(deck, resolveCard(e.getKey()), e.getValue()))
                .toList());
    }

    private Card resolveCard(UUID cardId) {
        if (cardId == null) {
            return null;
        }
        return cardRepository.findById(cardId)
                .orElseThrow(() -> new ResourceNotFoundException("Card not found: " + cardId));
    }

    private Player requirePlayer(UUID playerId) {
        return playerRepository.findById(playerId)
                .orElseThrow(() -> new ResourceNotFoundException("Player not found: " + playerId));
    }

    private Deck requireDeck(UUID playerId, UUID deckId) {
        return deckRepository.findByIdAndPlayerId(deckId, playerId)
                .orElseThrow(() -> new ResourceNotFoundException("Deck not found: " + deckId));
    }
}
