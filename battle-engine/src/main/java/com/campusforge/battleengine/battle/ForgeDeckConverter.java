package com.campusforge.battleengine.battle;

import com.campusforge.battleengine.supabase.SupabaseClient.SupabaseDeck;
import forge.StaticData;
import forge.deck.CardPool;
import forge.item.PaperCard;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Converts a deck fetched from Supabase (deck_cards joined with cards.forge_name)
 * into a {@link forge.deck.Deck} for the headless engine.
 */
@Component
public class ForgeDeckConverter {

    private static final Logger log = LoggerFactory.getLogger(ForgeDeckConverter.class);

    public forge.deck.Deck toForgeDeck(SupabaseDeck deck) {
        forge.deck.Deck forgeDeck = new forge.deck.Deck(deck.name());
        CardPool main = forgeDeck.getMain();
        int added = 0;
        int skipped = 0;

        for (SupabaseDeck.CardSlot slot : deck.cards()) {
            PaperCard paperCard = StaticData.instance().getCommonCards().getCard(slot.forgeName());
            if (paperCard == null) {
                skipped += slot.quantity();
                log.warn("No Forge card for '{}', skipping {} copies", slot.forgeName(), slot.quantity());
                continue;
            }
            main.add(paperCard.getName(), paperCard.getEdition(), slot.quantity());
            added += slot.quantity();
        }

        log.info("Converted deck '{}' for Forge: {} cards added, {} skipped", deck.name(), added, skipped);
        return forgeDeck;
    }
}