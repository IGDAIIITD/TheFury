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

                // UNLOCK - original set earned by scanning QR codes around campus
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

                // ---- WHITE ----
                new Card("33333333-3333-4333-9333-333333333301", "Savannah Lions", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Creature — Cat", "W", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-333333333302", "Suntail Hawk", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Creature — Bird", "W", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-333333333303", "Benalish Hero", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Creature — Human Soldier", "W", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-333333333304", "Soul Warden", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Creature — Human Cleric", "W", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-333333333305", "Swords to Plowshares", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 1, "Instant", "W", null, true, "Library", 4.0),
                new Card("33333333-3333-4333-9333-333333333306", "Condemn", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 1, "Instant", "W", null, true, "Library", 4.0),
                new Card("33333333-3333-4333-9333-333333333307", "White Knight", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Creature — Human Knight", "W", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-333333333308", "Knight of the White Orchid", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 2, "Creature — Human Knight", "W", null, true, "Library", 4.0),
                new Card("33333333-3333-4333-9333-333333333309", "Pacifism", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Enchantment — Aura", "W", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-33333333330a", "Suture Priest", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 2, "Creature — Phyrexian Cleric", "W", null, true, "Library", 4.0),
                new Card("33333333-3333-4333-9333-33333333330b", "Serra Angel", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 5, "Creature — Angel", "W", null, true, "Library", 4.0),

                // ---- BLUE ----
                new Card("33333333-3333-4333-9333-33333333330c", "Brainstorm", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Instant", "U", null, true, "Building B", 5.0),
                new Card("33333333-3333-4333-9333-33333333330d", "Opt", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Instant", "U", null, true, "Building B", 5.0),
                new Card("33333333-3333-4333-9333-33333333330e", "Serum Visions", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Sorcery", "U", null, true, "Building B", 5.0),
                new Card("33333333-3333-4333-9333-33333333330f", "Coral Merfolk", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Creature — Merfolk", "U", null, true, "Building B", 5.0),
                new Card("33333333-3333-4333-9333-333333333310", "Man-o'-War", "Common", OwnershipType.UNLOCK,
                        "M19", 3, "Creature — Jellyfish", "U", null, true, "Building B", 5.0),
                new Card("33333333-3333-4333-9333-333333333311", "Phantom Warrior", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 3, "Creature — Illusion Warrior", "U", null, true, "Building B", 4.0),
                new Card("33333333-3333-4333-9333-333333333312", "Divination", "Common", OwnershipType.UNLOCK,
                        "M19", 3, "Sorcery", "U", null, true, "Building B", 5.0),
                new Card("33333333-3333-4333-9333-333333333313", "Windfall", "Rare", OwnershipType.UNLOCK,
                        "M19", 3, "Sorcery", "U", null, true, "Building B", 2.0),
                new Card("33333333-3333-4333-9333-333333333314", "Mnemonic Wall", "Common", OwnershipType.UNLOCK,
                        "M19", 5, "Creature — Wall", "U", null, true, "Building B", 5.0),
                new Card("33333333-3333-4333-9333-333333333315", "Air Elemental", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 5, "Creature — Elemental", "U", null, true, "Building B", 4.0),
                new Card("33333333-3333-4333-9333-333333333316", "Cloud Djinn", "Common", OwnershipType.UNLOCK,
                        "M19", 6, "Creature — Djinn", "U", null, true, "Building B", 5.0),

                // ---- BLACK ----
                new Card("33333333-3333-4333-9333-333333333317", "Dark Ritual", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Instant", "B", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-333333333318", "Viscera Seer", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Creature — Vampire Wizard", "B", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-333333333319", "Thrull Surgeon", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Creature — Thrull", "B", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-33333333331a", "Sign in Blood", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Sorcery", "B", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-33333333331b", "Terror", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 2, "Instant", "B", null, true, "Library", 4.0),
                new Card("33333333-3333-4333-9333-33333333331c", "Nantuko Shade", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 2, "Creature — Insect Shade", "B", null, true, "Library", 4.0),
                new Card("33333333-3333-4333-9333-33333333331d", "Drudge Skeletons", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Creature — Skeleton", "B", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-33333333331e", "Dark Banishing", "Common", OwnershipType.UNLOCK,
                        "M19", 3, "Instant", "B", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-33333333331f", "Hypnotic Specter", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 3, "Creature — Specter", "B", null, true, "Library", 4.0),
                new Card("33333333-3333-4333-9333-333333333320", "Drain Life", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Sorcery", "B", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-333333333321", "Giant Cockroach", "Common", OwnershipType.UNLOCK,
                        "M19", 4, "Creature — Insect", "B", null, true, "Library", 5.0),
                new Card("33333333-3333-4333-9333-333333333322", "Nightmare", "Rare", OwnershipType.UNLOCK,
                        "M19", 6, "Creature — Nightmare Horse", "B", null, true, "Library", 2.0),
                new Card("33333333-3333-4333-9333-333333333323", "Skeletal Vampire", "Common", OwnershipType.UNLOCK,
                        "M19", 6, "Creature — Vampire Skeleton", "B", null, true, "Library", 5.0),

                // ---- RED ----
                new Card("33333333-3333-4333-9333-333333333324", "Goblin Guide", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Creature — Goblin Scout", "R", null, true, "Gym", 5.0),
                new Card("33333333-3333-4333-9333-333333333325", "Goblin Grenade", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Sorcery", "R", null, true, "Gym", 5.0),
                new Card("33333333-3333-4333-9333-333333333326", "Seal of Fire", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Enchantment", "R", null, true, "Gym", 5.0),
                new Card("33333333-3333-4333-9333-333333333327", "Lava Spike", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Sorcery — Arcane", "R", null, true, "Gym", 5.0),
                new Card("33333333-3333-4333-9333-333333333328", "Incinerate", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Instant", "R", null, true, "Gym", 5.0),
                new Card("33333333-3333-4333-9333-333333333329", "Searing Spear", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Instant", "R", null, true, "Gym", 5.0),
                new Card("33333333-3333-4333-9333-33333333332a", "Volcanic Hammer", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Sorcery", "R", null, true, "Gym", 5.0),
                new Card("33333333-3333-4333-9333-33333333332b", "Arc Trail", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Sorcery", "R", null, true, "Gym", 5.0),
                new Card("33333333-3333-4333-9333-33333333332c", "Viashino Pyromancer", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Creature — Lizard Wizard", "R", null, true, "Gym", 5.0),
                new Card("33333333-3333-4333-9333-33333333332d", "Goblin Chieftain", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 3, "Creature — Goblin", "R", null, true, "Gym", 4.0),
                new Card("33333333-3333-4333-9333-33333333332e", "Goblin Ruinblaster", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 3, "Creature — Goblin Shaman", "R", null, true, "Gym", 4.0),
                new Card("33333333-3333-4333-9333-33333333332f", "Goblin Trenches", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 3, "Enchantment", "R", null, true, "Gym", 4.0),
                new Card("33333333-3333-4333-9333-333333333330", "Dragon Whelp", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 4, "Creature — Dragon", "R", null, true, "Gym", 4.0),
                new Card("33333333-3333-4333-9333-333333333331", "Shivan Dragon", "Rare", OwnershipType.UNLOCK,
                        "M19", 6, "Creature — Dragon", "R", null, true, "Gym", 2.0),

                // ---- GREEN ----
                new Card("33333333-3333-4333-9333-333333333332", "Rancor", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Enchantment — Aura", "G", null, true, "Engineering", 5.0),
                new Card("33333333-3333-4333-9333-333333333333", "Sakura-Tribe Elder", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Creature — Snake Shaman", "G", null, true, "Engineering", 5.0),
                new Card("33333333-3333-4333-9333-333333333334", "Rampant Growth", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Sorcery", "G", null, true, "Engineering", 5.0),
                new Card("33333333-3333-4333-9333-333333333335", "Nature's Lore", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Sorcery", "G", null, true, "Engineering", 5.0),
                new Card("33333333-3333-4333-9333-333333333336", "Centaur Courser", "Common", OwnershipType.UNLOCK,
                        "M19", 3, "Creature — Centaur Warrior", "G", null, true, "Engineering", 5.0),
                new Card("33333333-3333-4333-9333-333333333337", "Cultivate", "Common", OwnershipType.UNLOCK,
                        "M19", 3, "Sorcery", "G", null, true, "Engineering", 5.0),
                new Card("33333333-3333-4333-9333-333333333338", "Yavimaya Elder", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 3, "Creature — Human Druid", "G", null, true, "Engineering", 4.0),
                new Card("33333333-3333-4333-9333-333333333339", "Terravore", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 3, "Creature — Lhurgoyf", "G", null, true, "Engineering", 4.0),
                new Card("33333333-3333-4333-9333-33333333333a", "Stampeding Elk Herd", "Common", OwnershipType.UNLOCK,
                        "M19", 5, "Creature — Elk", "G", null, true, "Engineering", 5.0),
                new Card("33333333-3333-4333-9333-33333333333b", "Stampeding Rhino", "Common", OwnershipType.UNLOCK,
                        "M19", 5, "Creature — Rhino", "G", null, true, "Engineering", 5.0),
                new Card("33333333-3333-4333-9333-33333333333c", "Baloth Woodcrasher", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 6, "Creature — Beast", "G", null, true, "Engineering", 4.0),

                // ---- ARTIFACTS / COLORLESS ----
                new Card("33333333-3333-4333-9333-33333333333d", "Phyrexian Walker", "Common", OwnershipType.UNLOCK,
                        "M19", 0, "Artifact Creature — Phyrexian Construct", "", null, true, "Special", 5.0),
                new Card("33333333-3333-4333-9333-33333333333e", "Brass Man", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Artifact Creature — Construct", "", null, true, "Special", 5.0),
                new Card("33333333-3333-4333-9333-33333333333f", "Skullclamp", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 1, "Artifact — Equipment", "", null, true, "Special", 4.0),
                new Card("33333333-3333-4333-9333-333333333340", "Sol Ring", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 1, "Artifact", "", null, true, "Special", 4.0),
                new Card("33333333-3333-4333-9333-333333333341", "Shadowblood Egg", "Common", OwnershipType.UNLOCK,
                        "M19", 1, "Artifact", "", null, true, "Special", 5.0),
                new Card("33333333-3333-4333-9333-333333333342", "Iron Myr", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Artifact Creature — Myr", "", null, true, "Special", 5.0),
                new Card("33333333-3333-4333-9333-333333333343", "Leaden Myr", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Artifact Creature — Myr", "", null, true, "Special", 5.0),
                new Card("33333333-3333-4333-9333-333333333344", "Silver Myr", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Artifact Creature — Myr", "", null, true, "Special", 5.0),
                new Card("33333333-3333-4333-9333-333333333345", "Wurm's Tooth", "Common", OwnershipType.UNLOCK,
                        "M19", 2, "Artifact", "", null, true, "Special", 5.0),
                new Card("33333333-3333-4333-9333-333333333346", "Armored Transport", "Common", OwnershipType.UNLOCK,
                        "M19", 3, "Artifact Creature — Construct", "", null, true, "Special", 5.0),
                new Card("33333333-3333-4333-9333-333333333347", "Bottled Cloister", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 4, "Artifact", "", null, true, "Special", 4.0),
                new Card("33333333-3333-4333-9333-333333333348", "Clockwork Beast", "Uncommon", OwnershipType.UNLOCK,
                        "M19", 6, "Artifact Creature — Beast", "", null, true, "Special", 4.0),
                new Card("33333333-3333-4333-9333-333333333349", "Darksteel Colossus", "Rare", OwnershipType.UNLOCK,
                        "M19", 11, "Artifact Creature — Golem", "", null, true, "Special", 2.0),

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
