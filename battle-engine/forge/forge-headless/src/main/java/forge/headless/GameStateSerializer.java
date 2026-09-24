package forge.headless;

import forge.card.mana.ManaAtom;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.phase.PhaseType;
import forge.game.player.PlayerView;
import forge.game.spellability.StackItemView;
import forge.util.collect.FCollectionView;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Converts Forge's {@link GameView} into a plain {@code Map} tree that can be
 * serialized to JSON and pushed to clients over WebSocket.
 *
 * <p>The common state contains everything both players may see (life, hand
 * size, battlefield, stack, phase, priority). Hand contents are private and are
 * provided separately via {@link #serializeHand(GameView, int)} so each player
 * only ever receives their own hand. Cards carry a stable integer id (the
 * Forge card id) so clients can track individual cards. Permanent cards also
 * carry combat-relevant fields (tapped, attacking, blocking, damage, power,
 * toughness, type, cost) so the client can render a live combat board.</p>
 */
public final class GameStateSerializer {

    private GameStateSerializer() {}

    public static Map<String, Object> serialize(GameView view) {
        Map<String, Object> out = new LinkedHashMap<>();

        out.put("turn", view.getTurn());

        PhaseType phase = view.getPhase();
        out.put("phase", phase == null ? null : phase.name());

        PlayerView activePlayer = view.getPlayerTurn();
        out.put("activePlayerIndex", activePlayer == null ? -1 : indexOf(view, activePlayer));

        List<Map<String, Object>> players = new ArrayList<>();
        FCollectionView<PlayerView> playerViews = view.getPlayers();
        for (int i = 0; i < playerViews.size(); i++) {
            players.add(serializePlayer(i, playerViews.get(i)));
        }
        out.put("players", players);

        List<Map<String, Object>> stack = new ArrayList<>();
        for (StackItemView item : view.getStack()) {
            Map<String, Object> stackItem = new LinkedHashMap<>();
            CardView source = item.getSourceCard();
            stackItem.put("cardName", source == null ? null : cardName(source));
            stackItem.put("activatingPlayerIndex", item.getActivatingPlayer() == null
                    ? -1 : indexOf(view, item.getActivatingPlayer()));
            stackItem.put("isAbility", item.isAbility());
            stack.add(stackItem);
        }
        out.put("stack", stack);

        return out;
    }

    /** The private hand of the player at {@code playerIndex}. */
    public static List<Map<String, Object>> serializeHand(GameView view, int playerIndex) {
        List<Map<String, Object>> hand = new ArrayList<>();
        PlayerView player = view.getPlayers().get(playerIndex);
        if (player == null) {
            return hand;
        }
        for (CardView card : player.getHand()) {
            hand.add(serializeCard(card, true));
        }
        return hand;
    }

    private static Map<String, Object> serializePlayer(int index, PlayerView player) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("index", index);
        p.put("name", player.getLobbyPlayerName());
        p.put("life", player.getLife());
        p.put("hasPriority", player.getHasPriority());
        p.put("hasLost", player.getHasLost());

        // Live mana pool (public info). Letters follow ManaAtom.MANATYPES order:
        // W, U, B, R, G, C. Zeros are included for a stable shape.
        String[] manaLetters = {"W", "U", "B", "R", "G", "C"};
        Map<String, Object> mana = new LinkedHashMap<>();
        for (int i = 0; i < ManaAtom.MANATYPES.length; i++) {
            mana.put(manaLetters[i], player.getMana(ManaAtom.MANATYPES[i]));
        }
        p.put("mana", mana);

        p.put("handSize", player.getHand().size());
        p.put("librarySize", player.getLibrary().size());

        List<Map<String, Object>> battlefield = new ArrayList<>();
        for (CardView card : player.getBattlefield()) {
            battlefield.add(serializeCard(card, false));
        }
        p.put("battlefield", battlefield);

        List<Map<String, Object>> graveyard = new ArrayList<>();
        for (CardView card : player.getGraveyard()) {
            graveyard.add(serializeCard(card, false));
        }
        p.put("graveyard", graveyard);

        return p;
    }

    /** Stable id, name and combat-relevant fields for a card. */
    private static Map<String, Object> serializeCard(CardView card, boolean includeOracleText) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("id", card.getId());
        entry.put("name", cardName(card));

        CardView.CardStateView state = card.getCurrentState();
        if (state != null) {
            entry.put("type", state.getType() == null ? null : state.getType().toString());
            entry.put("cost", state.getManaCost() == null ? null : state.getManaCost().toString());
            if (state.getType() != null && state.getType().isCreature()) {
                entry.put("power", state.getPower());
                entry.put("toughness", state.getToughness());
            }
            if (includeOracleText && state.getOracleText() != null) {
                String text = state.getOracleText();
                if (text.length() > 220) {
                    text = text.substring(0, 220) + "…";
                }
                entry.put("text", text);
            }
        }

        entry.put("tapped", card.isTapped());
        entry.put("attacking", card.isAttacking());
        entry.put("blocking", card.isBlocking());
        entry.put("damage", card.getDamage());
        return entry;
    }

    private static int indexOf(GameView view, PlayerView player) {
        FCollectionView<PlayerView> players = view.getPlayers();
        for (int i = 0; i < players.size(); i++) {
            if (players.get(i).equals(player)) {
                return i;
            }
        }
        return -1;
    }

    private static String cardName(CardView card) {
        return card.getCurrentState().getName();
    }
}
