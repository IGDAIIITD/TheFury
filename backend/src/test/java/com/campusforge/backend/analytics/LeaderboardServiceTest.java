package com.campusforge.backend.analytics;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.CardRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LeaderboardServiceTest {

    @Mock
    PlayerRepository playerRepository;
    @Mock
    CardRepository cardRepository;
    @Mock
    PlayerMetrics metrics;

    LeaderboardService service;
    Player low;
    Player high;
    Player noMatches;

    @BeforeEach
    void setUp() {
        service = new LeaderboardService(playerRepository, cardRepository, metrics);
        low = player("Low");
        high = player("High");
        noMatches = player("Fresh");
    }

    @Test
    void levelMetricRanksByLevelThenExperience() {
        when(playerRepository.findAll()).thenReturn(List.of(low, high, noMatches));
        when(metrics.levelFor(low)).thenReturn(5);
        when(metrics.levelFor(high)).thenReturn(13);
        when(metrics.levelFor(noMatches)).thenReturn(1);

        LeaderboardResponse response = service.leaderboard(low.getId(), "level", 50, null, null, null);

        assertThat(response.rows()).hasSize(3);
        assertThat(response.rows().get(0).displayName()).isEqualTo("High");
        assertThat(response.rows().get(0).score()).isEqualTo(13);
        assertThat(response.rows().get(2).displayName()).isEqualTo("Fresh");
        assertThat(response.myRank()).isEqualTo(2);
    }

    @Test
    void collectionMetricUsesCompletionPercent() {
        when(playerRepository.findAll()).thenReturn(List.of(low, high));
        when(metrics.ownedCardIds(low)).thenReturn(Set.of(UUID.randomUUID()));
        when(metrics.ownedCardIds(high)).thenReturn(Set.of(UUID.randomUUID(), UUID.randomUUID()));
        when(cardRepository.count()).thenReturn(10L);
        when(metrics.completionPercent(1, 10)).thenReturn(10);
        when(metrics.completionPercent(2, 10)).thenReturn(20);

        LeaderboardResponse response = service.leaderboard(low.getId(), "collection", 50, null, null, null);

        assertThat(response.rows().get(0).displayName()).isEqualTo("High");
        assertThat(response.rows().get(0).score()).isEqualTo(20);
        assertThat(response.rows().get(1).value()).isEqualTo(1);
    }

    @Test
    void winrateMetricRanksByWinRate() {
        when(playerRepository.findAll()).thenReturn(List.of(low, high, noMatches));
        when(metrics.battleStats(low)).thenReturn(new PlayerMetrics.BattleStats(10, 8, 2, 80));
        when(metrics.battleStats(high)).thenReturn(new PlayerMetrics.BattleStats(2, 1, 1, 50));
        when(metrics.battleStats(noMatches)).thenReturn(new PlayerMetrics.BattleStats(0, 0, 0, 0));

        LeaderboardResponse response = service.leaderboard(high.getId(), "winrate", 50, null, null, null);

        assertThat(response.rows().get(0).displayName()).isEqualTo("Low");
        assertThat(response.rows().get(0).score()).isEqualTo(80);
        assertThat(response.rows().get(2).score()).isZero();
        assertThat(response.myRank()).isEqualTo(2);
    }

    @Test
    void limitIsClamped() {
        when(playerRepository.findAll()).thenReturn(List.of(low, high, noMatches));
        when(metrics.levelFor(low)).thenReturn(5);
        when(metrics.levelFor(high)).thenReturn(13);
        when(metrics.levelFor(noMatches)).thenReturn(1);

        LeaderboardResponse response = service.leaderboard(low.getId(), "level", 2, null, null, null);

        assertThat(response.rows()).hasSize(2);
        assertThat(response.myRank()).isEqualTo(2);
    }

    @Test
    void degreeLevelFilterRestrictsRowsAndRecalculatesMyRank() {
        high.setDegreeLevel("BTECH");
        low.setDegreeLevel("MTECH");
        noMatches.setDegreeLevel(null);
        when(playerRepository.findAll()).thenReturn(List.of(low, high, noMatches));
        when(metrics.levelFor(high)).thenReturn(13);

        LeaderboardResponse response = service.leaderboard(low.getId(), "level", 50, "BTECH", null, null);

        assertThat(response.rows()).hasSize(1);
        assertThat(response.rows().get(0).displayName()).isEqualTo("High");
        assertThat(response.myRank()).isNull();
    }

    @Test
    void specializationFilterRestrictsRows() {
        high.setDegreeLevel("BTECH");
        high.setSpecialization("CSAI");
        low.setDegreeLevel("BTECH");
        low.setSpecialization("CSE");
        when(playerRepository.findAll()).thenReturn(List.of(low, high, noMatches));
        when(metrics.levelFor(high)).thenReturn(13);

        LeaderboardResponse response = service.leaderboard(low.getId(), "level", 50, null, "CSAI", null);

        assertThat(response.rows()).hasSize(1);
        assertThat(response.rows().get(0).displayName()).isEqualTo("High");
        assertThat(response.rows().get(0).specialization()).isEqualTo("CSAI");
    }

    @Test
    void departmentFilterRollsUpSpecializations() {
        high.setDegreeLevel("BTECH");
        high.setSpecialization("CSAI");
        low.setDegreeLevel("MTECH");
        low.setSpecialization("ECE");
        Player eve = new Player();
        eve.setId(UUID.randomUUID());
        eve.setDisplayName("VLSI");
        eve.setDegreeLevel("BTECH");
        eve.setSpecialization("EVE");
        when(playerRepository.findAll()).thenReturn(List.of(low, high, eve, noMatches));
        when(metrics.levelFor(low)).thenReturn(5);
        when(metrics.levelFor(eve)).thenReturn(2);

        LeaderboardResponse response = service.leaderboard(low.getId(), "level", 50, null, null, "ECE");

        assertThat(response.rows()).hasSize(2);
        assertThat(response.rows()).extracting(r -> r.displayName())
                .containsExactlyInAnyOrder("VLSI", "Low");
    }

    @Test
    void rowsCarryCohortFields() {
        high.setDegreeLevel("BTECH");
        high.setSpecialization("CSAM");
        noMatches.setDegreeLevel("MTECH");
        noMatches.setSpecialization("CSE");
        when(playerRepository.findAll()).thenReturn(List.of(high, noMatches));
        when(metrics.levelFor(high)).thenReturn(13);
        when(metrics.levelFor(noMatches)).thenReturn(3);

        LeaderboardResponse response = service.leaderboard(high.getId(), "level", 50, null, null, null);

        assertThat(response.rows().get(0).degreeLevel()).isEqualTo("BTECH");
        assertThat(response.rows().get(0).specialization()).isEqualTo("CSAM");
        assertThat(response.rows().get(1).degreeLevel()).isEqualTo("MTECH");
        assertThat(response.rows().get(1).specialization()).isEqualTo("CSE");
    }

    private Player player(String name) {
        Player p = new Player();
        p.setId(UUID.randomUUID());
        p.setDisplayName(name);
        return p;
    }
}
