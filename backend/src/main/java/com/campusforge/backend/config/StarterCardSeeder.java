package com.campusforge.backend.config;

import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.collection.OwnershipType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Adds the extra creature cards used by the starter deck granted to every new
 * player. Idempotent: cards already present (by oracleId) are left untouched,
 * so this can run against both fresh and previously-seeded databases.
 */
@Component
@Order(1)
public class StarterCardSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(StarterCardSeeder.class);

    private final CardRepository cardRepository;

    public StarterCardSeeder(CardRepository cardRepository) {
        this.cardRepository = cardRepository;
    }

    @Override
    @Transactional
    public void run(String... args) {
        int added = 0;
        for (StarterCard card : STARTER_CARDS) {
            if (cardRepository.existsByOracleId(card.oracleId())) {
                continue;
            }
            cardRepository.save(new Card(card.oracleId(), card.name(), "Common", OwnershipType.UNLOCK,
                    "M19", card.manaValue(), card.types(), card.colors(), null, true, card.spawnRegion(), 5.0));
            added++;
        }
        if (added > 0) {
            log.info("Seeded {} starter creature cards into the catalog.", added);
        }
    }

    private record StarterCard(String oracleId, String name, Integer manaValue, String types,
                               String colors, String spawnRegion) {
    }

    private static final List<StarterCard> STARTER_CARDS = List.of(
            new StarterCard("11111111-1111-4111-8111-111111111101", "Grizzly Bears", 2, "Creature — Bear", "G", "Engineering"),
            new StarterCard("11111111-1111-4111-8111-111111111102", "Elvish Warrior", 2, "Creature — Elf Warrior", "G", "Engineering"),
            new StarterCard("11111111-1111-4111-8111-111111111103", "Elvish Archers", 2, "Creature — Elf Archer", "G", "Engineering"),
            new StarterCard("11111111-1111-4111-8111-111111111104", "Trained Armodon", 3, "Creature — Elephant", "G", "Library"),
            new StarterCard("11111111-1111-4111-8111-111111111105", "Cudgel Troll", 4, "Creature — Troll", "G", "Library"),
            new StarterCard("11111111-1111-4111-8111-111111111106", "Giant Spider", 4, "Creature — Spider", "G", "Library"),
            new StarterCard("11111111-1111-4111-8111-111111111107", "War Mammoth", 4, "Creature — Elephant", "G", "Library"),
            new StarterCard("11111111-1111-4111-8111-111111111108", "Craw Wurm", 6, "Creature — Wurm", "G", "Library"),
            new StarterCard("11111111-1111-4111-8111-111111111109", "Raging Goblin", 1, "Creature — Goblin Berserker", "R", "Gym"),
            new StarterCard("11111111-1111-4111-8111-11111111110a", "Goblin Piker", 2, "Creature — Goblin Warrior", "R", "Gym"),
            new StarterCard("11111111-1111-4111-8111-11111111110b", "Goblin Mountaineer", 2, "Creature — Goblin Scout", "R", "Gym"),
            new StarterCard("11111111-1111-4111-8111-11111111110c", "Goblin Hero", 3, "Creature — Goblin", "R", "Gym"),
            new StarterCard("11111111-1111-4111-8111-11111111110d", "Vulshok Berserker", 3, "Creature — Human Berserker", "R", "Gym"),
            new StarterCard("11111111-1111-4111-8111-11111111110e", "Hill Giant", 4, "Creature — Giant", "R", "Gym"),
            new StarterCard("11111111-1111-4111-8111-11111111110f", "Fire Elemental", 5, "Creature — Elemental", "R", "Gym")
    );
}
