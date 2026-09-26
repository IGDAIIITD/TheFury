package forge.headless;

import java.util.ArrayList;
import java.util.List;

/**
 * A decision that a human player must make during a game. Produced by a
 * {@link HumanPlayerController} whenever it blocks the game thread on input,
 * and serialized into the per-player game state so the web client can render
 * it. The player's answer is a {@link Choice} carrying option indices.
 */
public class ChoiceRequest {

    private final long id;
    private final String type;
    private final String prompt;
    private final boolean cancellable;
    private final int minCount;
    private final int maxCount;
    private final List<ChoiceOption> options;

    public ChoiceRequest(long id, String type, String prompt, boolean cancellable,
                         int minCount, int maxCount, List<ChoiceOption> options) {
        this.id = id;
        this.type = type;
        this.prompt = prompt;
        this.cancellable = cancellable;
        this.minCount = minCount;
        this.maxCount = maxCount;
        this.options = options == null ? new ArrayList<>() : options;
    }

    public long getId() { return id; }
    public String getType() { return type; }
    public String getPrompt() { return prompt; }
    public boolean isCancellable() { return cancellable; }
    public int getMinCount() { return minCount; }
    public int getMaxCount() { return maxCount; }
    public List<ChoiceOption> getOptions() { return options; }

    public static class ChoiceOption {
        private final String label;
        private final String value;
        /** Id of the card this option is about (the card itself, or a spell's host), if any. */
        private final Integer cardId;

        public ChoiceOption(String label, String value) {
            this(label, value, null);
        }

        public ChoiceOption(String label, String value, Integer cardId) {
            this.label = label;
            this.value = value;
            this.cardId = cardId;
        }

        public String getLabel() { return label; }
        public String getValue() { return value; }
        public Integer getCardId() { return cardId; }
    }
}
