package com.campusforge.backend.analytics;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.achievements.AchievementService;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.common.ResourceNotFoundException;
import com.campusforge.backend.qr.ClaimRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PlayerStatsServiceTest {

    @Mock
    PlayerRepository playerRepository;
    @Mock
    CardRepository cardRepository;
    @Mock
    PlayerMetrics metrics;
    @Mock
    AchievementService achievementService;
    @Mock
    ClaimRepository claimRepository;

    PlayerStatsService service;
    Player player;

    @BeforeEach
    void setUp() {
        service = new PlayerStatsService(playerRepository, cardRepository, metrics, achievementService, claimRepository);
        player = new Player();
        player.setId(UUID.randomUUID());
        player.setEmail("tester@campus.edu");
        player.setDisplayName("Tester");
        player.setStudentId("S0001");
        player.setExperience(1210);
    }

    @Test
    void myStatsAssemblesMetricsAndStoredBadges() {
        when(playerRepository.findById(player.getId())).thenReturn(Optional.of(player));
        when(metrics.levelFor(player)).thenReturn(13);
        when(metrics.experienceToNextLevel(player)).thenReturn(190L);
        when(metrics.totalDiscoveries(player)).thenReturn(4L);
        Set<UUID> owned = Set.of(UUID.randomUUID(), UUID.randomUUID());
        when(metrics.ownedCardIds(player)).thenReturn(owned);
        when(cardRepository.count()).thenReturn(10L);
        when(metrics.completionPercent(2, 10)).thenReturn(20);
        when(metrics.favoriteColors(owned, List.of())).thenReturn(List.of("G"));
        when(metrics.battleStats(player)).thenReturn(new PlayerMetrics.BattleStats(3, 2, 1, 67));
        when(claimRepository.findByClaimedById(player.getId())).thenReturn(List.of());
        when(achievementService.badgesFor(player.getId())).thenReturn(List.of(
                new ProfileStatsDto.BadgeDto("FIRST_DISCOVERY", "First Discovery", "Discover your first card."),
                new ProfileStatsDto.BadgeDto("BATTLE_VETERAN", "Battle Veteran", "Win your first battle."),
                new ProfileStatsDto.BadgeDto("HALL_OF_FAME", "Hall of Fame", "Reach level 10.")));

        ProfileStatsDto stats = service.myStats(player.getId());

        assertThat(stats.player().displayName()).isEqualTo("Tester");
        assertThat(stats.level()).isEqualTo(13);
        assertThat(stats.experienceToNextLevel()).isEqualTo(190);
        assertThat(stats.collectionCompletionPercent()).isEqualTo(20);
        assertThat(stats.ownedCards()).isEqualTo(2);
        assertThat(stats.totalCards()).isEqualTo(10);
        assertThat(stats.totalDiscoveries()).isEqualTo(4);
        assertThat(stats.favoriteColors()).containsExactly("G");
        assertThat(stats.battleStats().played()).isEqualTo(3);
        assertThat(stats.battleStats().winRatePercent()).isEqualTo(67);
        assertThat(stats.badges()).anyMatch(b -> b.code().equals("FIRST_DISCOVERY"));
        assertThat(stats.badges()).anyMatch(b -> b.code().equals("BATTLE_VETERAN"));
        assertThat(stats.badges()).anyMatch(b -> b.code().equals("HALL_OF_FAME"));
        assertThat(stats.badges()).noneMatch(b -> b.code().equals("COMPLETIONIST"));
    }

    @Test
    void noStoredBadgesYieldsEmptyBadgeList() {
        when(playerRepository.findById(player.getId())).thenReturn(Optional.of(player));
        when(metrics.levelFor(player)).thenReturn(1);
        when(metrics.experienceToNextLevel(player)).thenReturn(0L);
        when(metrics.totalDiscoveries(player)).thenReturn(0L);
        when(metrics.ownedCardIds(player)).thenReturn(Set.of());
        when(cardRepository.count()).thenReturn(10L);
        when(metrics.completionPercent(0, 10)).thenReturn(0);
        when(metrics.favoriteColors(Set.of(), List.of())).thenReturn(List.of());
        when(metrics.battleStats(player)).thenReturn(new PlayerMetrics.BattleStats(0, 0, 0, 0));
        when(claimRepository.findByClaimedById(player.getId())).thenReturn(List.of());
        when(achievementService.badgesFor(player.getId())).thenReturn(List.of());

        ProfileStatsDto stats = service.myStats(player.getId());

        assertThat(stats.badges()).isEmpty();
    }

    @Test
    void missingPlayerThrows() {
        when(playerRepository.findById(player.getId())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.myStats(player.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void playerResponseCarriesCohortFields() {
        player.setDegreeLevel("MTECH");
        player.setSpecialization("CSE");
        when(playerRepository.findById(player.getId())).thenReturn(Optional.of(player));
        when(metrics.levelFor(player)).thenReturn(1);
        when(metrics.experienceToNextLevel(player)).thenReturn(0L);
        when(metrics.totalDiscoveries(player)).thenReturn(0L);
        when(metrics.ownedCardIds(player)).thenReturn(Set.of());
        when(cardRepository.count()).thenReturn(10L);
        when(metrics.completionPercent(0, 10)).thenReturn(0);
        when(metrics.favoriteColors(Set.of(), List.of())).thenReturn(List.of());
        when(metrics.battleStats(player)).thenReturn(new PlayerMetrics.BattleStats(0, 0, 0, 0));
        when(claimRepository.findByClaimedById(player.getId())).thenReturn(List.of());
        when(achievementService.badgesFor(player.getId())).thenReturn(List.of());

        ProfileStatsDto stats = service.myStats(player.getId());

        assertThat(stats.player().degreeLevel()).isEqualTo("MTECH");
        assertThat(stats.player().specialization()).isEqualTo("CSE");
    }

    @Test
    void buildingsVisitedAreDistinctTrimmedAndSorted() {
        com.campusforge.backend.qr.Claim b1 = new com.campusforge.backend.qr.Claim(
                "T1", "T1", counterspellCard(), "  Block C ", null);
        com.campusforge.backend.qr.Claim b2 = new com.campusforge.backend.qr.Claim(
                "T2", "T2", counterspellCard(), "Block A", null);
        com.campusforge.backend.qr.Claim b3 = new com.campusforge.backend.qr.Claim(
                "T3", "T3", counterspellCard(), "Block C", null);
        com.campusforge.backend.qr.Claim noBuilding = new com.campusforge.backend.qr.Claim(
                "T4", "T4", counterspellCard(), null, null);
        when(claimRepository.findByClaimedById(player.getId()))
                .thenReturn(List.of(b1, b2, b3, noBuilding));

        assertThat(service.buildingsVisited(player.getId())).containsExactly("Block A", "Block C");
    }

    private com.campusforge.backend.collection.Card counterspellCard() {
        com.campusforge.backend.collection.Card card = new com.campusforge.backend.collection.Card(
                "oracle-counter", "Counterspell", "Common", com.campusforge.backend.collection.OwnershipType.UNLOCK,
                "M19", 2, "Instant", "U", null, true, "Building B", 5.0);
        card.setId(UUID.randomUUID());
        return card;
    }
}
