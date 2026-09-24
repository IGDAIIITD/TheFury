package forge.headless;

import java.util.List;

/**
 * A player's answer to a {@link ChoiceRequest}. Indices refer to the
 * {@code options} list of the request that was shown to the player.
 */
public class Choice {

    private final long requestId;
    private final List<Integer> selectedIndices;
    private final boolean cancel;

    public Choice(long requestId, List<Integer> selectedIndices) {
        this(requestId, selectedIndices, false);
    }

    public Choice(long requestId, List<Integer> selectedIndices, boolean cancel) {
        this.requestId = requestId;
        this.selectedIndices = selectedIndices;
        this.cancel = cancel;
    }

    public long getRequestId() { return requestId; }
    public List<Integer> getSelectedIndices() { return selectedIndices; }
    public boolean isCancel() { return cancel; }
}
