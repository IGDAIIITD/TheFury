package forge.headless;

import forge.LobbyPlayer;
import forge.ai.AIOption;
import forge.ai.ComputerUtilMana;
import forge.ai.PlayerControllerAi;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameObject;
import forge.game.ForgeDebug;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardView;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.player.Player;
import forge.game.player.PlayerActionConfirmMode;
import forge.game.player.DelayedReveal;
import forge.game.player.PlayerView;
import forge.game.player.PlaySpellAbility;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;
import forge.util.collect.FCollectionView;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;

/**
 * A player controller for a human playing through the web client. The match
 * thread blocks whenever a decision is needed, the decision is surfaced to the
 * client through the game state stream (see {@link #getPendingRequest()}), and
 * the client answers via {@link #submitChoice(long, List)}.
 *
 * <p>Only the "core" decisions are presented to the human: casting/passing,
 * choosing targets, choosing cards, attackers/blockers, mulligan, starting
 * player and confirmations. Everything else (mana auto-tap, ordering, exotic
 * choices) falls through to the AI so games always progress. If the player
 * disconnects and the grace period expires, {@link #triggerAiFallback()} makes
 * this controller hand every subsequent decision to the AI.</p>
 */
public class HumanPlayerController extends PlayerControllerAi {

    private final AtomicLong requestSeq = new AtomicLong();
    private final AtomicBoolean aiFallback = new AtomicBoolean(false);
    private volatile boolean passNextPlay = false;
    private final BlockingQueue<Choice> responses = new LinkedBlockingQueue<>();
    private volatile ChoiceRequest pendingRequest;
    private volatile Runnable onChoiceRequested = () -> { };

    public HumanPlayerController(Game game, Player player, LobbyPlayer lobbyPlayer) {
        super(game, player, lobbyPlayer);
        getAi().setUseSimulation(AIOption.USE_HYBRID_SIMULATION);
    }

    /** The decision currently waiting for input, or null if none. */
    public ChoiceRequest getPendingRequest() {
        return pendingRequest;
    }

    /** Registers the callback fired the moment a new decision is published. */
    public void setOnChoiceRequested(Runnable onChoiceRequested) {
        this.onChoiceRequested = onChoiceRequested == null ? () -> { } : onChoiceRequested;
    }

    /**
     * Submits a player's answer. Only accepts answers for the currently pending
     * request. Called from the backend (WebSocket) thread.
     */
    public boolean submitChoice(long requestId, List<Integer> selectedIndices) {
        ChoiceRequest req = pendingRequest;
        if (req == null || req.getId() != requestId) {
            return false;
        }
        responses.offer(new Choice(requestId, selectedIndices == null ? new ArrayList<>() : selectedIndices));
        return true;
    }

    /** Permanently hands all future decisions to the AI (disconnect grace expiry). */
    public void triggerAiFallback() {
        aiFallback.set(true);
    }

    private Choice await(ChoiceRequest req) {
        if (aiFallback.get()) {
            return null;
        }
        if (ForgeDebug.traces()) {
            System.err.println("[HPC] choice type=" + req.getType() + " prompt=" + req.getPrompt());
        }
        pendingRequest = req;
        onChoiceRequested.run();
        try {
            while (true) {
                Choice c = responses.poll(100, TimeUnit.MILLISECONDS);
                if (c != null) {
                    return c;
                }
                if (aiFallback.get()) {
                    return null;
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } finally {
            pendingRequest = null;
        }
    }

    // ------------------------------------------------------------------
    // Core overrides
    // ------------------------------------------------------------------

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        if (aiFallback.get()) {
            return super.chooseSpellAbilityToPlay();
        }
        if (passNextPlay) {
            // the previous cast failed (e.g. no mana) - pass instead of re-offering
            passNextPlay = false;
            return null;
        }
        List<SpellAbility> playable = getPlayableSAs();
        if (playable.isEmpty()) {
            return null; // nothing to do, pass priority
        }
        Choice c = requestOptions("play", "Cast a spell, activate an ability, or pass priority",
                0, playable.size(), playable, this::saLabel, true);
        if (c == null) {
            return super.chooseSpellAbilityToPlay();
        }
        if (c.isCancel() || c.getSelectedIndices().isEmpty()) {
            return null; // pass
        }
        List<SpellAbility> chosen = new ArrayList<>();
        for (int i : c.getSelectedIndices()) {
            if (i >= 0 && i < playable.size()) {
                chosen.add(playable.get(i));
            }
        }
        return chosen;
    }

    @Override
    public boolean playChosenSpellAbility(SpellAbility sa) {
        if (ForgeDebug.traces()) {
            System.err.println("[HPC] playChosenSpellAbility " + (sa == null ? "null" : sa.getHostCard().getName()));
        }
        if (aiFallback.get()) {
            return super.playChosenSpellAbility(sa);
        }
        boolean ok;
        if (sa.isLandAbility()) {
            if (sa.canPlay()) {
                sa.resolve();
            }
            ok = true;
        } else {
            ok = PlaySpellAbility.playSpellAbility(this, getPlayer(), sa);
        }
        if (!ok) {
            if (ForgeDebug.traces()) {
                System.err.println("[HPC] cast FAILED for " + sa.getHostCard().getName() + " - passing");
            }
            passNextPlay = true;
        }
        // Returning false keeps PhaseHandler from granting this player priority
        // again (117.3c applies only to a successfully played spell/land), so a
        // failed cast cannot ping-pong priority between the two players.
        return ok;
    }

    @Override
    public boolean chooseTargetsFor(SpellAbility sa) {
        if (ForgeDebug.traces()) {
            System.err.println("[HPC] chooseTargetsFor called, sa=" + (sa == null ? "null" : sa.getHostCard().getName()) + " usesTargeting=" + (sa != null && sa.usesTargeting()));
        }
        if (aiFallback.get()) {
            return super.chooseTargetsFor(sa);
        }
        sa.clearTargets();

        List<GameEntity> candidates = new ArrayList<>();
        for (Card card : getGame().getCardsInGame()) {
            if (sa.canTarget(card)) {
                candidates.add(card);
            }
        }
        for (Player p : getGame().getPlayers()) {
            if (sa.canTarget(p)) {
                candidates.add(p);
            }
        }

        int min = sa.getMinTargets();
        int max = Math.max(min, Math.min(sa.getMaxTargets(), candidates.size()));
        if (candidates.isEmpty()) {
            return min == 0;
        }

        String prompt = sa.getDescription() == null ? "Choose target(s)" : sa.getDescription();
        Choice c = requestOptions("target", prompt, min, max, candidates, this::entityLabel, false);
        if (c == null) {
            return super.chooseTargetsFor(sa);
        }
        if (c.isCancel()) {
            sa.clearTargets();
            return false;
        }
        for (int i : c.getSelectedIndices()) {
            if (i >= 0 && i < candidates.size()) {
                sa.getTargets().add(candidates.get(i));
            }
        }
        return true;
    }

    @Override
    public void declareAttackers(Player attacker, Combat combat) {
        if (ForgeDebug.traces()) {
            System.err.println("[HPC] declareAttackers called, creatures=" + (attacker == null ? "?" : attacker.getCreaturesInPlay().size()));
        }
        if (aiFallback.get()) {
            super.declareAttackers(attacker, combat);
            return;
        }
        GameEntity defender = null;
        for (Player p : getGame().getPlayers()) {
            if (!p.equals(attacker)) {
                defender = p;
                break;
            }
        }
        if (defender == null) {
            return;
        }
        List<Card> candidates = new ArrayList<>();
        for (Card c : attacker.getCreaturesInPlay()) {
            if (CombatUtil.canAttack(c, defender)) {
                candidates.add(c);
            }
        }
        if (candidates.isEmpty()) {
            return; // nothing can attack
        }
        Choice c = requestOptions("attack", "Choose creatures to attack with (none to skip)",
                0, candidates.size(), candidates, Card::getName, true);
        if (c == null) {
            super.declareAttackers(attacker, combat);
            return;
        }
        for (int i : c.getSelectedIndices()) {
            if (i >= 0 && i < candidates.size()) {
                Card card = candidates.get(i);
                if (CombatUtil.canAttack(card, defender)) {
                    combat.addAttacker(card, defender);
                }
            }
        }
    }

    @Override
    public void declareBlockers(Player defender, Combat combat) {
        if (ForgeDebug.traces()) {
            System.err.println("[HPC] declareBlockers called, creatures=" + (defender == null ? "?" : defender.getCreaturesInPlay().size()));
        }
        if (aiFallback.get()) {
            super.declareBlockers(defender, combat);
            return;
        }
        List<Card> candidates = new ArrayList<>();
        for (Card blocker : defender.getCreaturesInPlay()) {
            if (CombatUtil.canBlock(blocker, combat)) {
                candidates.add(blocker);
            }
        }
        if (candidates.isEmpty()) {
            return; // nothing can block
        }
        Choice c = requestOptions("block", "Choose creatures to block with (none to skip)",
                0, candidates.size(), candidates, Card::getName, true);
        if (c == null) {
            super.declareBlockers(defender, combat);
            return;
        }
        for (int i : c.getSelectedIndices()) {
            if (i < 0 || i >= candidates.size()) {
                continue;
            }
            Card blocker = candidates.get(i);
            for (Card attacker : combat.getAttackers()) {
                if (CombatUtil.canBlock(attacker, blocker, combat)) {
                    combat.addBlocker(attacker, blocker);
                    break;
                }
            }
        }
    }

    @Override
    public boolean mulliganKeepHand(Player player, int cardsToReturn) {
        if (aiFallback.get()) {
            return super.mulliganKeepHand(player, cardsToReturn);
        }
        int size = player.getZone(ZoneType.Hand).size();
        String prompt = "Keep this hand of " + size + " card(s)?"
                + (cardsToReturn > 0 ? " (return " + cardsToReturn + " card(s) to the library)" : "");
        Choice c = requestOptions("mulligan", prompt, 1, 1,
                List.of("Keep", "Mulligan"), s -> s, false);
        if (c == null) {
            return super.mulliganKeepHand(player, cardsToReturn);
        }
        return !c.getSelectedIndices().isEmpty() && c.getSelectedIndices().get(0) == 0;
    }

    @Override
    public Player chooseStartingPlayer(boolean isFirstGame) {
        if (aiFallback.get()) {
            return super.chooseStartingPlayer(isFirstGame);
        }
        List<Player> candidates = new ArrayList<>();
        for (Player p : getGame().getPlayers()) {
            candidates.add(p);
        }
        if (candidates.size() < 2) {
            return getPlayer();
        }
        Choice c = requestOptions("start", "Choose who plays first", 1, 1, candidates, Player::getName, false);
        if (c == null) {
            return super.chooseStartingPlayer(isFirstGame);
        }
        return c.getSelectedIndices().isEmpty() ? getPlayer() : candidates.get(c.getSelectedIndices().get(0));
    }

    @Override
    public boolean confirmAction(SpellAbility sa, PlayerActionConfirmMode mode, String message,
                                 List<String> options, Card cardToShow, Map<String, Object> params) {
        if (aiFallback.get()) {
            return super.confirmAction(sa, mode, message, options, cardToShow, params);
        }
        List<String> optionList = (options != null && !options.isEmpty()) ? options : List.of("Yes", "No");
        Choice c = requestOptions("confirm", message == null ? "Confirm" : message,
                1, 1, optionList, s -> s, false);
        if (c == null) {
            return super.confirmAction(sa, mode, message, options, cardToShow, params);
        }
        return !c.getSelectedIndices().isEmpty();
    }

    @Override
    public CardCollection chooseCardsToDiscardFrom(Player playerDiscard, SpellAbility sa,
                                                   CardCollection validCards, int min, int max,
                                                   CardCollectionView visibleToChooser) {
        if (aiFallback.get()) {
            return super.chooseCardsToDiscardFrom(playerDiscard, sa, validCards, min, max, visibleToChooser);
        }
        Choice c = requestCards("discard", "Choose " + min + " card(s) to discard",
                min, Math.min(max, validCards.size()), validCards);
        if (c == null) {
            return super.chooseCardsToDiscardFrom(playerDiscard, sa, validCards, min, max, visibleToChooser);
        }
        return mapToCards(validCards, c);
    }

    @Override
    public CardCollectionView chooseCardsToDiscardToMaximumHandSize(int numDiscard) {
        if (aiFallback.get()) {
            return super.chooseCardsToDiscardToMaximumHandSize(numDiscard);
        }
        CardCollectionView hand = player.getZone(ZoneType.Hand).getCards();
        Choice c = requestCards("discard", "Choose " + numDiscard + " card(s) to discard",
                numDiscard, numDiscard, hand);
        if (c == null) {
            return super.chooseCardsToDiscardToMaximumHandSize(numDiscard);
        }
        return mapToCards(hand, c);
    }

    @Override
    public CardCollectionView chooseCardsToRevealFromHand(int min, int max, CardCollectionView valid) {
        if (aiFallback.get()) {
            return super.chooseCardsToRevealFromHand(min, max, valid);
        }
        Choice c = requestCards("reveal", "Choose " + min + " card(s) to reveal",
                min, Math.min(max, valid.size()), valid);
        if (c == null) {
            return super.chooseCardsToRevealFromHand(min, max, valid);
        }
        return mapToCards(valid, c);
    }

    @Override
    public CardCollectionView chooseCardsForEffect(CardCollectionView sourceList, SpellAbility sa, String title,
                                                   int min, int max, boolean isOptional, Map<String, Object> params) {
        if (aiFallback.get()) {
            return super.chooseCardsForEffect(sourceList, sa, title, min, max, isOptional, params);
        }
        Choice c = requestCards("choose", title == null ? "Choose cards" : title,
                min, Math.min(max, sourceList.size()), sourceList);
        if (c == null) {
            return super.chooseCardsForEffect(sourceList, sa, title, min, max, isOptional, params);
        }
        return mapToCards(sourceList, c);
    }

    @Override
    public <T extends GameEntity> T chooseSingleEntityForEffect(FCollectionView<T> optionList,
            DelayedReveal delayedReveal, SpellAbility sa, String title, boolean isOptional,
            Player relatedPlayer, Map<String, Object> params) {
        if (aiFallback.get()) {
            return super.chooseSingleEntityForEffect(optionList, delayedReveal, sa, title, isOptional, relatedPlayer, params);
        }
        if (delayedReveal != null) {
            reveal(delayedReveal);
        }
        List<T> list = new ArrayList<>();
        for (T e : optionList) {
            list.add(e);
        }
        if (list.isEmpty()) {
            return null;
        }
        Choice c = requestOptions("choose", title == null ? "Choose" : title,
                isOptional ? 0 : 1, 1, list, this::entityLabel, isOptional);
        if (c == null) {
            return super.chooseSingleEntityForEffect(optionList, delayedReveal, sa, title, isOptional, relatedPlayer, params);
        }
        return c.getSelectedIndices().isEmpty() ? null : list.get(c.getSelectedIndices().get(0));
    }

    @Override
    public <T extends GameEntity> List<T> chooseEntitiesForEffect(FCollectionView<T> optionList, int min, int max,
            DelayedReveal delayedReveal, SpellAbility sa, String title, Player relatedPlayer,
            Map<String, Object> params) {
        if (aiFallback.get()) {
            return super.chooseEntitiesForEffect(optionList, min, max, delayedReveal, sa, title, relatedPlayer, params);
        }
        List<T> list = new ArrayList<>();
        for (T e : optionList) {
            list.add(e);
        }
        if (list.isEmpty()) {
            return new ArrayList<>();
        }
        Choice c = requestOptions("choose", title == null ? "Choose" : title,
                min, Math.min(max, list.size()), list, this::entityLabel, false);
        if (c == null) {
            return super.chooseEntitiesForEffect(optionList, min, max, delayedReveal, sa, title, relatedPlayer, params);
        }
        List<T> result = new ArrayList<>();
        for (int i : c.getSelectedIndices()) {
            if (i >= 0 && i < list.size()) {
                result.add(list.get(i));
            }
        }
        return result;
    }

    @Override
    public SpellAbility chooseSingleSpellForEffect(List<SpellAbility> spells, SpellAbility sa,
                                                   String title, Map<String, Object> params) {
        if (aiFallback.get()) {
            return super.chooseSingleSpellForEffect(spells, sa, title, params);
        }
        if (spells == null || spells.isEmpty()) {
            return null;
        }
        Choice c = requestOptions("choose", title == null ? "Choose" : title, 1, 1, spells, this::saLabel, false);
        if (c == null) {
            return super.chooseSingleSpellForEffect(spells, sa, title, params);
        }
        return c.getSelectedIndices().isEmpty() ? null : spells.get(c.getSelectedIndices().get(0));
    }

    // ------------------------------------------------------------------
    // Notifications (no input required)
    // ------------------------------------------------------------------

    @Override
    public void reveal(CardCollectionView cards, ZoneType zone, Player owner, String messagePrefix, boolean addMsgSuffix) {
        // TODO: surface revealed cards to the web client as an info notice.
    }

    @Override
    public void reveal(List<CardView> cards, ZoneType zone, PlayerView owner, String messagePrefix, boolean addMsgSuffix) {
        // TODO: surface revealed cards to the web client as an info notice.
    }

    @Override
    public void notifyOfValue(SpellAbility saSource, GameObject relatedTarget, String value) {
        // TODO: surface as an info notice.
    }

    @Override
    public void revealAISkipCards(String message, Map<Player, Map<DeckSection, List<? extends PaperCard>>> deckCards) {
        // no-op
    }

    @Override
    public void revealUnsupported(Map<Player, List<PaperCard>> unsupported) {
        // no-op
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private List<SpellAbility> getPlayableSAs() {
        CardCollection cards = new CardCollection(player.getCardsIn(ZoneType.Hand));
        cards.addAll(player.getCardsIn(ZoneType.Battlefield));
        List<SpellAbility> result = new ArrayList<>();
        for (Card c : cards) {
            for (SpellAbility sa : c.getAllPossibleAbilities(player, true)) {
                if ((sa.isSpell() || sa.isLandAbility() || sa.isActivatedAbility()) && sa.canPlay()) {
                    if (!sa.isManaAbility() && !sa.isLandAbility() && sa.getPayCosts() != null) {
                        if (!ComputerUtilMana.canPayManaCost(sa.getPayCosts(), sa, player, 0, false)) {
                            continue;
                        }
                    }
                    result.add(sa);
                }
            }
        }
        return result;
    }

    private String saLabel(SpellAbility sa) {
        String name = sa.getHostCard().getName();
        if (sa.isLandAbility()) {
            return name + " - Play as land";
        }
        String desc = sa.getDescription() == null ? "" : sa.getDescription();
        if (sa.isManaAbility()) {
            desc = desc + " (mana)";
        }
        return name + " - " + desc;
    }

    private String entityLabel(GameEntity e) {
        if (e instanceof Card) {
            return e.toString();
        }
        return e.toString();
    }

    private Choice requestCards(String type, String prompt, int min, int max, CardCollectionView cards) {
        if (cards == null || cards.isEmpty()) {
            return new Choice(0, new ArrayList<>());
        }
        List<Card> list = new ArrayList<>();
        for (Card c : cards) {
            list.add(c);
        }
        return requestOptions(type, prompt, min, max, list, Card::getName, false);
    }

    private <T> Choice requestOptions(String type, String prompt, int min, int max,
                                      List<T> items, Function<T, String> labelFn, boolean cancellable) {
        List<ChoiceRequest.ChoiceOption> options = new ArrayList<>();
        for (int i = 0; i < items.size(); i++) {
            options.add(new ChoiceRequest.ChoiceOption(labelFn.apply(items.get(i)), String.valueOf(i), cardIdOf(items.get(i))));
        }
        ChoiceRequest req = new ChoiceRequest(requestSeq.incrementAndGet(), type, prompt, cancellable,
                min, Math.max(min, max), options);
        return await(req);
    }

    /**
     * The card an option refers to, so clients can tell identical cards apart (two
     * "Elvish Warrior" attackers have the same label). Null for players, modes, etc.
     */
    private static Integer cardIdOf(Object item) {
        if (item instanceof Card card) {
            return card.getId();
        }
        if (item instanceof SpellAbility sa && sa.getHostCard() != null) {
            return sa.getHostCard().getId();
        }
        return null;
    }

    private CardCollection mapToCards(CardCollectionView source, Choice c) {
        CardCollection result = new CardCollection();
        List<Card> list = new ArrayList<>();
        for (Card card : source) {
            list.add(card);
        }
        if (c.isCancel()) {
            return result;
        }
        for (int i : c.getSelectedIndices()) {
            if (i >= 0 && i < list.size()) {
                result.add(list.get(i));
            }
        }
        return result;
    }
}
