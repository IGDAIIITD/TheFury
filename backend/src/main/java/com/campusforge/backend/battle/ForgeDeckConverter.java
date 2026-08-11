package com.campusforge.backend.battle;

import com.campusforge.backend.deck.Deck;
import com.campusforge.backend.deck.DeckCard;
import forge.StaticData;
import forge.deck.CardPool;
import forge.item.PaperCard;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Converts a persisted backend {@link Deck} into a {@link ForgeDeck} using the
 * card {@code forgeName} mapping populated by the card catalog seeder.
 */
@Component
public class ForgeDeckConverter {

    private static final Logger log = LoggerFactory.getLogger(ForgeDeckConverter.class);

    public forge.deck.Deck toForgeDeck(Deck deck) {
        forge.deck.Deck forgeDeck = new forge.deck.Deck(deck.getName());
        CardPool main = forgeDeck.getMain();
        int added = 0;
        int skipped = 0;

        for (DeckCard deckCard : deck.getCards()) {
            String forgeName = deckCard.getCard().getForgeName();
            PaperCard paperCard = StaticData.instance().getCommonCards().getCard(forgeName);
            if (paperCard == null) {
                skipped += deckCard.getQuantity();
                log.warn("No Forge card for '{}', skipping {} copies", forgeName, deckCard.getQuantity());
                continue;
            }
            main.add(paperCard.getName(), paperCard.getEdition(), deckCard.getQuantity());
            added += deckCard.getQuantity();
        }

        log.info("Converted deck '{}' for Forge: {} cards added, {} skipped",
                deck.getName(), added, skipped);
        return forgeDeck;
    }
}
