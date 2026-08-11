package com.campusforge.backend.achievements;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.analytics.PlayerMetrics;
import com.campusforge.backend.analytics.ProfileStatsDto;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.common.events.AchievementUnlockedEvent;
import com.campusforge.backend.common.events.CardDiscoveredEvent;
import com.campusforge.backend.common.events.MatchWonEvent;
import com.campusforge.backend.common.events.TradeAcceptedEvent;
import com.campusforge.backend.trade.TradeRepository;
import com.campusforge.backend.trade.TradeStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AchievementServiceTest {

    @Mock
    PlayerAchievementRepository achievementRepository;
    @Mock
    PlayerRepository playerRepository;
    @Mock
    PlayerMetrics playerMetrics;
    @Mock
    TradeRepository tradeRepository;
    @Mock
    CardRepository cardRepository;
    @Mock
    ApplicationEventPublisher publisher;

    AchievementService service;

    Player player;
    UUID playerId;

    @BeforeEach
    void setUp() {
        service = new AchievementService(achievementRepository, playerRepository, playerMetrics,
                tradeRepository, cardRepository, publisher);
        playerId = UUID.randomUUID();
        player = new Player();
        player.setId(playerId);
        player.setDisplayName("Tester");
    }

    private void stubBaseMetrics() {
        when(playerRepository.findById(playerId)).thenReturn(Optional.of(player));
        when(playerMetrics.battleStats(player)).thenReturn(new PlayerMetrics.BattleStats(1, 1, 0, 100));
        when(playerMetrics.levelFor(player)).thenReturn(5);
        when(playerMetrics.totalDiscoveries(player)).thenReturn(2L);
        when(playerMetrics.ownedCardIds(player)).thenReturn(Set.of());
        when(cardRepository.count()).thenReturn(10L);
        when(tradeRepository.countByStatusAndPlayer(eq(TradeStatus.ACCEPTED), eq(playerId))).thenReturn(0L);
    }

    @Test
    void unlockForUnlocksAllMetThresholds() {
        stubBaseMetrics();
        when(achievementRepository.existsByPlayerIdAndCode(eq(playerId), anyString())).thenReturn(false);

        List<AchievementUnlockedEvent.AchievementUnlockedItem> unlocked = service.unlockFor(playerId);

        // discoveries>=1, wins>=1, undefeated, level>=5 => 4 achievements; no collectors/traders
        assertThat(unlocked).extracting(AchievementUnlockedEvent.AchievementUnlockedItem::code)
                .containsExactlyInAnyOrder("FIRST_DISCOVERY", "BATTLE_VETERAN", "UNDEFEATED", "RISING_STAR");
        verify(achievementRepository, times(4)).save(any(PlayerAchievement.class));
        ArgumentCaptor<AchievementUnlockedEvent> captor = ArgumentCaptor.forClass(AchievementUnlockedEvent.class);
        verify(publisher).publishEvent(captor.capture());
        assertThat(captor.getValue().playerId()).isEqualTo(playerId);
        assertThat(captor.getValue().achievements()).hasSize(4);
    }

    @Test
    void unlockForIsIdempotentWhenAlreadyStored() {
        stubBaseMetrics();
        when(achievementRepository.existsByPlayerIdAndCode(eq(playerId), anyString())).thenReturn(true);

        List<AchievementUnlockedEvent.AchievementUnlockedItem> unlocked = service.unlockFor(playerId);

        assertThat(unlocked).isEmpty();
        verify(achievementRepository, never()).save(any(PlayerAchievement.class));
        verify(publisher, never()).publishEvent(any());
    }

    @Test
    void unlockForRequiresPlayer() {
        when(playerRepository.findById(playerId)).thenReturn(Optional.empty());

        assertThat(service.unlockFor(playerId)).isEmpty();
        verify(achievementRepository, never()).save(any(PlayerAchievement.class));
    }

    @Test
    void badgesForMapsStoredCodesThroughCatalog() {
        PlayerAchievement stored = new PlayerAchievement(player, "FIRST_DISCOVERY", LocalDateTime.now());
        PlayerAchievement unknown = new PlayerAchievement(player, "MYSTERY", LocalDateTime.now());
        when(achievementRepository.findByPlayerIdOrderByUnlockedAt(playerId))
                .thenReturn(List.of(stored, unknown));

        List<ProfileStatsDto.BadgeDto> badges = service.badgesFor(playerId);

        assertThat(badges).hasSize(2);
        assertThat(badges.get(0).code()).isEqualTo("FIRST_DISCOVERY");
        assertThat(badges.get(0).name()).isEqualTo("First Discovery");
        assertThat(badges.get(1).code()).isEqualTo("MYSTERY");
    }

    @Test
    void discoveryListenerUnlocksForPlayer() {
        when(playerRepository.findById(playerId)).thenReturn(Optional.of(player));
        when(playerMetrics.battleStats(player)).thenReturn(new PlayerMetrics.BattleStats(0, 0, 0, 0));
        when(playerMetrics.levelFor(player)).thenReturn(1);
        when(playerMetrics.totalDiscoveries(player)).thenReturn(1L);
        when(playerMetrics.ownedCardIds(player)).thenReturn(Set.of());
        when(cardRepository.count()).thenReturn(10L);
        when(tradeRepository.countByStatusAndPlayer(TradeStatus.ACCEPTED, playerId)).thenReturn(0L);
        when(achievementRepository.existsByPlayerIdAndCode(eq(playerId), anyString())).thenReturn(false);

        service.onCardDiscovered(new CardDiscoveredEvent(playerId, "Tester", "Counterspell", true, 10));

        verify(achievementRepository).save(any(PlayerAchievement.class));
    }

    @Test
    void tradeListenerUnlocksForBothParties() {
        UUID otherId = UUID.randomUUID();
        Player other = new Player();
        other.setId(otherId);
        when(playerRepository.findById(playerId)).thenReturn(Optional.of(player));
        when(playerRepository.findById(otherId)).thenReturn(Optional.of(other));
        when(playerMetrics.battleStats(any())).thenReturn(new PlayerMetrics.BattleStats(0, 0, 0, 0));
        when(playerMetrics.levelFor(any())).thenReturn(1);
        when(playerMetrics.totalDiscoveries(any())).thenReturn(0L);
        when(playerMetrics.ownedCardIds(any())).thenReturn(Set.of());
        when(cardRepository.count()).thenReturn(10L);
        when(tradeRepository.countByStatusAndPlayer(eq(TradeStatus.ACCEPTED), any())).thenReturn(1L);
        when(achievementRepository.existsByPlayerIdAndCode(any(), anyString())).thenReturn(false);

        service.onTradeAccepted(new TradeAcceptedEvent(playerId, "Tester", otherId, "Other"));

        verify(achievementRepository, times(2)).save(any(PlayerAchievement.class));
    }
}
