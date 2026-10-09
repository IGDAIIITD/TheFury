package forge.headless;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HumanPlayerControllerChoiceTest {

    @Test
    void ignoresLateResponsesAndReturnsOnlyTheCurrentPromptAnswer() throws InterruptedException {
        LinkedBlockingQueue<Choice> responses = new LinkedBlockingQueue<>();
        responses.offer(new Choice(1, List.of()));
        responses.offer(new Choice(2, List.of(1)));

        Choice response = HumanPlayerController.pollResponse(responses, 2);

        assertEquals(2, response.getRequestId());
        assertEquals(List.of(1), response.getSelectedIndices());
        assertTrue(responses.isEmpty());
    }

    @Test
    void rejectsDuplicateAndOutOfOrderAnswers() {
        AtomicLong lastAnsweredRequestId = new AtomicLong();

        assertTrue(HumanPlayerController.markResponseSubmitted(lastAnsweredRequestId, 1));
        assertFalse(HumanPlayerController.markResponseSubmitted(lastAnsweredRequestId, 1));
        assertTrue(HumanPlayerController.markResponseSubmitted(lastAnsweredRequestId, 2));
        assertFalse(HumanPlayerController.markResponseSubmitted(lastAnsweredRequestId, 1));
    }

    @Test
    void returnsWhenNoResponseArrivesWithinThePollWindow() throws InterruptedException {
        Choice response = HumanPlayerController.pollResponse(new LinkedBlockingQueue<>(), 1);

        assertNull(response);
    }
}
