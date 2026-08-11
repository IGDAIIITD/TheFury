package com.campusforge.backend.config;

import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.deck.CardLegality;
import com.campusforge.backend.deck.CardLegalityRepository;
import com.campusforge.backend.deck.Format;
import com.campusforge.backend.deck.FormatRepository;
import com.campusforge.backend.deck.Legality;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Component
@Order(2)
public class FormatLegalSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(FormatLegalSeeder.class);

    private final FormatRepository formatRepository;
    private final CardRepository cardRepository;
    private final CardLegalityRepository legalityRepository;

    public FormatLegalSeeder(FormatRepository formatRepository,
                             CardRepository cardRepository,
                             CardLegalityRepository legalityRepository) {
        this.formatRepository = formatRepository;
        this.cardRepository = cardRepository;
        this.legalityRepository = legalityRepository;
    }

    private static final List<String> STANDARD_BANNED = List.of(
            "a0e1f2a3-4b5c-4d6e-7f8a-9b0c1d2e3f4a", // Black Lotus
            "c2f3a4b5-6c7d-4e8f-9a0b-1c2d3e4f5a6b", // Ancestral Recall
            "e4a5b6c7-8d9e-4f0a-1b2c-3d4e5f6a7b8c"  // Mox Sapphire
    );

    private static final List<String> COMMANDER_ELIGIBLE = List.of(
            "8c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f", // Solemn Simulacrum
            "a0e1f2a3-4b5c-4d6e-7f8a-9b0c1d2e3f4a"  // Black Lotus
    );

    @Override
    @Transactional
    public void run(String... args) {
        List<Format> formats = formatRepository.findAll();
        if (formats.isEmpty()) {
            log.info("No formats present yet, skipping legality seed.");
            return;
        }
        if (legalityRepository.count() > 0) {
            log.info("Card legalities already seeded, skipping.");
            return;
        }

        Format standard = formats.stream().filter(f -> f.getCode().equals("STANDARD")).findFirst().orElse(null);
        Format commander = formats.stream().filter(f -> f.getCode().equals("COMMANDER")).findFirst().orElse(null);

        long added = 0;
        for (Card card : cardRepository.findAll()) {
            if (COMMANDER_ELIGIBLE.contains(card.getOracleId())) {
                card.setCommanderEligible(true);
                cardRepository.save(card);
            }
            if (standard != null) {
                Legality leg = STANDARD_BANNED.contains(card.getOracleId()) ? Legality.BANNED : Legality.LEGAL;
                legalityRepository.save(new CardLegality(card, standard, leg));
                added++;
            }
            if (commander != null) {
                legalityRepository.save(new CardLegality(card, commander, Legality.LEGAL));
                added++;
            }
        }
        log.info("Seeded {} card legality entries for {} cards across {} formats.",
                added, cardRepository.count(), formats.size());
    }
}
