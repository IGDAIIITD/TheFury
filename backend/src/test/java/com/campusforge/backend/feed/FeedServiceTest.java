package com.campusforge.backend.feed;

import com.campusforge.backend.common.events.AchievementUnlockedEvent;
import com.campusforge.backend.common.events.CardDiscoveredEvent;
import com.campusforge.backend.common.events.EventLifecycleEvent;
import com.campusforge.backend.common.events.SpawnEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class FeedServiceTest {

    @Mock
    SimpMessagingTemplate messaging;

    FeedService service;

    @BeforeEach
    void setUp() {
        service = new FeedService(messaging);
    }

    @Test
    void publishAppendsToHistoryAndBroadcasts() {
        service.publish(FeedType.DISCOVERY, "discovered Counterspell", "Tester");

        List<FeedEntryDto> history = service.history();
        assertThat(history).hasSize(1);
        assertThat(history.get(0).type()).isEqualTo("DISCOVERY");
        assertThat(history.get(0).message()).isEqualTo("discovered Counterspell");
        assertThat(history.get(0).playerName()).isEqualTo("Tester");
        verify(messaging).convertAndSend(FeedService.FEED_TOPIC, history.get(0));
    }

    @Test
    void historyIsBoundedToCapacity() {
        for (int i = 0; i < 60; i++) {
            service.publish(FeedType.SPAWN, "spawned token " + i, "Admin");
        }

        List<FeedEntryDto> history = service.history();
        assertThat(history).hasSize(FeedService.CAPACITY);
        assertThat(history.get(0).message()).isEqualTo("spawned token 59");
        assertThat(history.get(history.size() - 1).message()).isEqualTo("spawned token 10");
    }

    @Test
    void cardDiscoveryListenerPublishesFeedEntry() {
        service.onCardDiscovered(new CardDiscoveredEvent(UUID.randomUUID(), "Tester", "Black Lotus", true, 10));

        assertThat(service.history()).hasSize(1);
        assertThat(service.history().get(0).type()).isEqualTo("DISCOVERY");
    }

    @Test
    void achievementListenerPublishesOneEntryPerAchievement() {
        service.onAchievementUnlocked(new AchievementUnlockedEvent(UUID.randomUUID(), "Tester",
                List.of(new AchievementUnlockedEvent.AchievementUnlockedItem("FIRST_DISCOVERY", "First Discovery"),
                        new AchievementUnlockedEvent.AchievementUnlockedItem("EXPLORER", "Explorer"))));

        assertThat(service.history()).hasSize(2);
        assertThat(service.history()).extracting(FeedEntryDto::type).containsOnly("ACHIEVEMENT");
    }

    @Test
    void eventLifecycleListenerPublishesEventEntry() {
        service.onEventLifecycle(new EventLifecycleEvent("Campus Cup", true, new BigDecimal("2.00")));

        assertThat(service.history()).hasSize(1);
        assertThat(service.history().get(0).type()).isEqualTo("EVENT");
        assertThat(service.history().get(0).message()).contains("Campus Cup").contains("2.00");
    }

    @Test
    void spawnListenerPublishesSpawnEntry() {
        service.onSpawn(new SpawnEvent("Admin", "Black Lotus", "Library", 5));

        assertThat(service.history()).hasSize(1);
        assertThat(service.history().get(0).type()).isEqualTo("SPAWN");
        assertThat(service.history().get(0).message()).contains("Black Lotus").contains("Library");
    }
}
