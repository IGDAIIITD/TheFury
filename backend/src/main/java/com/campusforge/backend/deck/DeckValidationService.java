package com.campusforge.backend.deck;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.collection.CollectionService;
import com.campusforge.backend.deck.dto.DeckCardRequest;
import com.campusforge.backend.deck.dto.DeckProblemDto;
import com.campusforge.backend.deck.dto.ValidateDeckRequest;
import com.campusforge.backend.events.Event;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class DeckValidationService {

    private final FormatRepository formatRepository;
    private final CardRepository cardRepository;
    private final CardLegalityRepository legalityRepository;
    private final CollectionService collectionService;

    public DeckValidationService(FormatRepository formatRepository,
                                 CardRepository cardRepository,
                                 CardLegalityRepository legalityRepository,
                                 CollectionService collectionService) {
        this.formatRepository = formatRepository;
        this.cardRepository = cardRepository;
        this.legalityRepository = legalityRepository;
        this.collectionService = collectionService;
    }

    @Transactional(readOnly = true)
    public DeckValidation validate(Player player, ValidateDeckRequest request) {
        List<DeckProblem> problems = new ArrayList<>();

        Format format = formatRepository.findByCode(request.formatCode())
                .orElse(null);
        if (format == null) {
            problems.add(DeckProblem.of("UNKNOWN_FORMAT", "Unknown format: " + request.formatCode()));
            return new DeckValidation(false, problems);
        }

        Map<UUID, Integer> requested = request.cards().stream()
                .collect(Collectors.groupingBy(DeckCardRequest::cardId,
                        Collectors.summingInt(DeckCardRequest::quantity)));

        Map<UUID, Card> cards = requested.keySet().stream()
                .map(cardRepository::findById)
                .filter(java.util.Optional::isPresent)
                .map(java.util.Optional::get)
                .collect(Collectors.toMap(Card::getId, Function.identity()));

        Map<UUID, Legality> legalities = legalityRepository.findByFormatId(format.getId()).stream()
                .collect(Collectors.toMap(cl -> cl.getCard().getId(), CardLegality::getLegality));

        for (Map.Entry<UUID, Integer> entry : requested.entrySet()) {
            UUID cardId = entry.getKey();
            int qty = entry.getValue();
            Card card = cards.get(cardId);

            if (card == null) {
                problems.add(DeckProblem.of("UNKNOWN_CARD", "Unknown card: " + cardId, cardId));
                continue;
            }

            if (!collectionService.owns(player.getId(), card.getId())) {
                problems.add(DeckProblem.of("NOT_OWNED", "You do not own: " + card.getForgeName(), cardId));
            }

            long ownedQty = collectionService.quantity(player.getId(), card.getId());
            if (ownedQty < qty) {
                problems.add(DeckProblem.of("NOT_ENOUGH_COPIES",
                        "Only " + ownedQty + " owned of: " + card.getForgeName(), cardId));
            }

            Legality legality = legalities.get(cardId);
            if (legality == Legality.BANNED) {
                problems.add(DeckProblem.of("BANNED", "Banned in " + format.getName() + ": " + card.getForgeName(), cardId));
            } else if (legality == Legality.RESTRICTED && qty > 1) {
                problems.add(DeckProblem.of("RESTRICTED", "Restricted to 1 copy in " + format.getName()
                        + ": " + card.getForgeName(), cardId));
            }

            if (isBasicLand(card) && format.isBasicsUnlimited()) {
                continue;
            }
            if (qty > format.getMaxCopies()) {
                problems.add(DeckProblem.of("TOO_MANY_COPIES",
                        "Max " + format.getMaxCopies() + " copies in " + format.getName() + ": " + card.getForgeName(), cardId));
            }
        }

        int totalCards = requested.values().stream().mapToInt(Integer::intValue).sum();
        if (totalCards < format.getMinDeckSize()) {
            problems.add(DeckProblem.of("TOO_FEW_CARDS",
                    "Minimum " + format.getMinDeckSize() + " cards, got " + totalCards));
        }
        if (format.getMaxDeckSize() != null && totalCards > format.getMaxDeckSize()) {
            problems.add(DeckProblem.of("TOO_MANY_CARDS",
                    "Maximum " + format.getMaxDeckSize() + " cards, got " + totalCards));
        }

        if (format.isCommanderRequired()) {
            validateCommander(player, request, cards, legalities, problems);
        }

        return new DeckValidation(problems.isEmpty(), problems);
    }

    /**
     * Validates a deck for an event match: the base validation plus a strict
     * set-eligibility check. Basic lands are exempt from the event's allowed-set
     * restriction so starter mana bases stay playable.
     */
    @Transactional(readOnly = true)
    public DeckValidation validate(Player player, ValidateDeckRequest request, Event event) {
        if (event == null) {
            return validate(player, request);
        }
        DeckValidation base = validate(player, request);
        List<DeckProblem> problems = new ArrayList<>(base.problems());

        Map<UUID, Card> cards = request.cards().stream()
                .map(DeckCardRequest::cardId)
                .map(cardRepository::findById)
                .filter(Optional::isPresent)
                .map(Optional::get)
                .collect(Collectors.toMap(Card::getId, Function.identity()));
        if (request.commanderCardId() != null) {
            cardRepository.findById(request.commanderCardId()).ifPresent(c -> cards.putIfAbsent(c.getId(), c));
        }

        for (Card card : cards.values()) {
            if (!isBasicLand(card) && !event.allowsSet(card.getSetCode())) {
                problems.add(DeckProblem.of("NOT_IN_EVENT",
                        card.getForgeName() + " (set " + card.getSetCode() + ") is not legal in event: " + event.getName(),
                        card.getId()));
            }
        }
        return new DeckValidation(problems.isEmpty(), problems);
    }

    private void validateCommander(Player player, ValidateDeckRequest request,
                                   Map<UUID, Card> cards,
                                   Map<UUID, Legality> legalities,
                                   List<DeckProblem> problems) {
        if (request.commanderCardId() == null) {
            problems.add(DeckProblem.of("NO_COMMANDER", "A commander is required."));
            return;
        }
        Card commander = cardRepository.findById(request.commanderCardId()).orElse(null);
        if (commander == null) {
            problems.add(DeckProblem.of("UNKNOWN_COMMANDER", "Unknown commander card", request.commanderCardId()));
            return;
        }
        if (!collectionService.owns(player.getId(), commander.getId())) {
            problems.add(DeckProblem.of("COMMANDER_NOT_OWNED",
                    "You do not own: " + commander.getForgeName(), commander.getId()));
        }
        if (!commander.isCommanderEligible()) {
            problems.add(DeckProblem.of("NOT_LEGENDARY", commander.getForgeName() + " cannot be a commander.", commander.getId()));
        }
        if (legalities.get(commander.getId()) == Legality.BANNED) {
            problems.add(DeckProblem.of("BANNED_COMMANDER", commander.getForgeName() + " is banned as commander.", commander.getId()));
        }

        String commanderColors = commander.getColors() == null ? "" : commander.getColors();
        for (Card card : cards.values()) {
            String cardColors = card.getColors() == null ? "" : card.getColors();
            if (!isColorSubset(cardColors, commanderColors)) {
                problems.add(DeckProblem.of("COLOR_IDENTITY",
                        card.getForgeName() + " (colors " + cardColors + ") is outside "
                                + commander.getForgeName() + "'s color identity (" + commanderColors + ").",
                        card.getId()));
            }
        }
    }

    private boolean isColorSubset(String cardColors, String commanderColors) {
        for (int i = 0; i < cardColors.length(); i++) {
            if (commanderColors.indexOf(cardColors.charAt(i)) < 0) {
                return false;
            }
        }
        return true;
    }

    private boolean isBasicLand(Card card) {
        return card.getTypes() != null && card.getTypes().contains("Basic Land");
    }

    public record DeckValidation(boolean valid, List<DeckProblem> problems) {
    }
}
