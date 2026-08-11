package com.campusforge.backend.starter;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.collection.Discovery;
import com.campusforge.backend.collection.DiscoveryRepository;
import com.campusforge.backend.collection.OwnershipType;
import com.campusforge.backend.collection.PlayerUnlock;
import com.campusforge.backend.collection.PlayerUnlockRepository;
import com.campusforge.backend.deck.Deck;
import com.campusforge.backend.deck.DeckCard;
import com.campusforge.backend.deck.DeckRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Grants every new player a playable starter deck ("RG Combat") plus ownership
 * of its cards. The roster is a 60-card STANDARD deck built around a suite of
 * attacking creatures so new players can immediately deal damage in battles.
 */
@Service
public class StarterDeckService {

    public static final String STARTER_DECK_NAME = "RG Combat";
    public static final String STARTER_FORMAT = "STANDARD";

    private static final List<RosterEntry> STARTER_ROSTER = List.of(
            // attacking creatures
            new RosterEntry("Llanowar Elves", 1),
            new RosterEntry("Raging Goblin", 1),
            new RosterEntry("Grizzly Bears", 1),
            new RosterEntry("Elvish Warrior", 1),
            new RosterEntry("Elvish Archers", 1),
            new RosterEntry("Goblin Piker", 1),
            new RosterEntry("Goblin Mountaineer", 1),
            new RosterEntry("Trained Armodon", 1),
            new RosterEntry("Goblin Hero", 1),
            new RosterEntry("Vulshok Berserker", 1),
            new RosterEntry("Cudgel Troll", 1),
            new RosterEntry("Giant Spider", 1),
            new RosterEntry("War Mammoth", 1),
            new RosterEntry("Hill Giant", 1),
            new RosterEntry("Fire Elemental", 1),
            new RosterEntry("Craw Wurm", 1),
            new RosterEntry("Solemn Simulacrum", 1),
            // burn
            new RosterEntry("Lightning Bolt", 1),
            new RosterEntry("Shock", 1),
            new RosterEntry("Giant Growth", 1),
            // lands
            new RosterEntry("Forest", 20),
            new RosterEntry("Mountain", 20)
    );

    private final CardRepository cardRepository;
    private final PlayerUnlockRepository unlockRepository;
    private final DiscoveryRepository discoveryRepository;
    private final DeckRepository deckRepository;

    public StarterDeckService(CardRepository cardRepository,
                              PlayerUnlockRepository unlockRepository,
                              DiscoveryRepository discoveryRepository,
                              DeckRepository deckRepository) {
        this.cardRepository = cardRepository;
        this.unlockRepository = unlockRepository;
        this.discoveryRepository = discoveryRepository;
        this.deckRepository = deckRepository;
    }

    @Transactional
    public void provision(Player player) {
        boolean alreadyProvisioned = deckRepository.findByPlayerId(player.getId()).stream()
                .anyMatch(d -> STARTER_DECK_NAME.equals(d.getName()));
        if (alreadyProvisioned) {
            return;
        }

        Map<String, Card> byName = STARTER_ROSTER.stream()
                .map(RosterEntry::name)
                .distinct()
                .map(name -> cardRepository.findByForgeName(name)
                        .orElseThrow(() -> new IllegalStateException("Starter card missing from catalog: " + name)))
                .collect(Collectors.toMap(Card::getForgeName, Function.identity()));

        for (Card card : byName.values()) {
            if (card.getOwnershipType() != OwnershipType.UNLOCK) {
                continue;
            }
            if (!unlockRepository.existsByPlayerAndCard(player, card)) {
                unlockRepository.save(new PlayerUnlock(player, card));
            }
            if (discoveryRepository.findByPlayerAndCard(player, card).isEmpty()) {
                discoveryRepository.save(new Discovery(player, card));
            }
        }

        Deck deck = new Deck(player, STARTER_DECK_NAME, STARTER_FORMAT, null);
        List<DeckCard> deckCards = new ArrayList<>(STARTER_ROSTER.size());
        for (RosterEntry entry : STARTER_ROSTER) {
            deckCards.add(new DeckCard(deck, byName.get(entry.name()), entry.quantity()));
        }
        deck.setCards(deckCards);
        deckRepository.save(deck);
    }

    private record RosterEntry(String name, int quantity) {
    }
}
