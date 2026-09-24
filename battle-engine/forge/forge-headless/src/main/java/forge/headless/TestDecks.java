package forge.headless;

import forge.deck.CardPool;
import forge.deck.Deck;

/**
 * Builds simple constructed decks straight from the card database for headless testing.
 */
public final class TestDecks {

    private static final String[][] CREATURES = {
            {"Grizzly Bears", "LEA", "4"},
            {"Hill Giant", "LEA", "8"},
            {"Shivan Dragon", "LEA", "4"},
    };

    private TestDecks() {}

    public static Deck build(String name, int size) {
        Deck deck = new Deck(name);
        CardPool main = deck.getMain();

        int lands = size - creatureCount();
        int forest = lands / 2;
        int mountain = lands - forest;

        main.add("Forest", "LEA", forest);
        main.add("Mountain", "LEA", mountain);

        for (String[] creature : CREATURES) {
            main.add(creature[0], creature[1], Integer.parseInt(creature[2]));
        }
        return deck;
    }

    private static int creatureCount() {
        int total = 0;
        for (String[] creature : CREATURES) {
            total += Integer.parseInt(creature[2]);
        }
        return total;
    }
}
