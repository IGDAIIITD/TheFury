package com.campusforge.backend.config;

import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.collection.OwnershipType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class CardCatalogSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(CardCatalogSeeder.class);

    private final CardRepository cardRepository;

    public CardCatalogSeeder(CardRepository cardRepository) {
        this.cardRepository = cardRepository;
    }

    @Override
    public void run(String... args) {
        int added = 0;
        for (Card card : SEED) {
            if (cardRepository.existsByOracleId(card.getOracleId())) {
                continue;
            }
            cardRepository.save(card);
            added++;
        }
        if (added > 0) {
            log.info("Seeded {} demo cards into the catalog.", added);
        }
    }

    private static final List<Card> SEED = List.of(
                // UNLIMITED - basic lands, always owned
                new Card("0d49a960-963a-46a4-8d3d-b3f7b0d7b3c4", "Plains", "Common", OwnershipType.UNLIMITED,
                        "M19", 0, "Basic Land — Plains", "W", null, true, "Library", 10.0),
                new Card("6d2ecbb5-5d0e-4bb4-8e8f-1f3a0c3e8b2a", "Island", "Common", OwnershipType.UNLIMITED,
                        "M19", 0, "Basic Land — Island", "U", null, true, "Library", 10.0),
                new Card("a7c4a5e1-5f6d-4a3b-9b2e-4f1c0d6e7a8f", "Swamp", "Common", OwnershipType.UNLIMITED,
                        "M19", 0, "Basic Land — Swamp", "B", null, true, "Library", 10.0),
                new Card("2b6f9d3e-8c1a-4b7e-9d0f-5e3a7b9c1d2f", "Mountain", "Common", OwnershipType.UNLIMITED,
                        "M19", 0, "Basic Land — Mountain", "R", null, true, "Library", 10.0),
                new Card("4c8e0a5f-9b2d-4c1e-8a3f-6d5b0e2f3a4c", "Forest", "Common", OwnershipType.UNLIMITED,
                        "M19", 0, "Basic Land — Forest", "G", null, true, "Library", 10.0),

                // UNLOCK - earned by scanning QR codes around campus
                new Card("5a1f2b3c-4d5e-4f6a-8b7c-9d0e1f2a3b4c", "Counterspell", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Instant", "U", null, true, "Building B", 5.0),
                new Card("7c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f", "Lightning Bolt", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Instant", "R", null, true, "Gym", 5.0),
                new Card("9e5f6a7b-8c9d-4a0b-1c2d-3e4f5a6b7c8d", "Giant Growth", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Instant", "G", null, true, "Engineering", 5.0),
                new Card("0b7c8d9e-0a1b-4c2d-3e4f-5a6b7c8d9e0f", "Cancel", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 3, "Instant", "U", null, true, "Building B", 4.0),
                new Card("2d9e0f1a-2b3c-4d4e-5f6a-7b8c9d0e1f2a", "Shock", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Instant", "R", null, true, "Gym", 5.0),
                new Card("4f0a1b2c-3d4e-4f5a-6b7c-8d9e0f1a2b3c", "Llanowar Elves", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Creature — Elf Druid", "G", null, true, "Engineering", 5.0),
                new Card("6a2b3c4d-5e6f-4a0b-1c2d-3e4f5a6b7c8d", "Doom Blade", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Instant", "B", null, true, "Library", 5.0),
                new Card("8c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f", "Solemn Simulacrum", "Rare", OwnershipType.UNLOCK,
                        "M19", 4, "Artifact Creature — Golem", "", null, true, "Engineering", 2.0),

                // UNIQUE - single serialized physical copies
                new Card("a0e1f2a3-4b5c-4d6e-7f8a-9b0c1d2e3f4a", "Black Lotus", "Mythic", OwnershipType.UNIQUE,
                        "LEA", 0, "Artifact", "", null, false, "Special", 0.1),
                new Card("c2f3a4b5-6c7d-4e8f-9a0b-1c2d3e4f5a6b", "Ancestral Recall", "Mythic", OwnershipType.UNIQUE,
                        "LEA", 1, "Instant", "U", null, false, "Special", 0.1),
                new Card("e4a5b6c7-8d9e-4f0a-1b2c-3d4e5f6a7b8c", "Mox Sapphire", "Mythic", OwnershipType.UNIQUE,
                        "LEA", 0, "Artifact", "", null, false, "Special", 0.1)
        );

        // Intentionally no saveAll here: cards are added individually above so
        // this seeder is order-independent with respect to StarterCardSeeder.
}
