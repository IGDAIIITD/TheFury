package com.campusforge.backend.analytics;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.battle.Match;
import com.campusforge.backend.battle.MatchRepository;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.collection.Discovery;
import com.campusforge.backend.collection.DiscoveryRepository;
import com.campusforge.backend.collection.OwnershipType;
import com.campusforge.backend.collection.PlayerUnlock;
import com.campusforge.backend.collection.PlayerUnlockRepository;
import com.campusforge.backend.collection.UniqueCard;
import com.campusforge.backend.collection.UniqueCardRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PlayerMetricsTest {

    @Mock
    CardRepository cardRepository;
    @Mock
    PlayerUnlockRepository unlockRepository;
    @Mock
    UniqueCardRepository uniqueCardRepository;
    @Mock
    DiscoveryRepository discoveryRepository;
    @Mock
    MatchRepository matchRepository;

    PlayerMetrics metrics;
    Player player;
    Player opponent;
    Card plains;
    Card counterspell;
    Card blackLotus;

    @BeforeEach
    void setUp() {
        metrics = new PlayerMetrics(cardRepository, unlockRepository, uniqueCardRepository,
                discoveryRepository, matchRepository);
        player = new Player();
        player.setId(UUID.randomUUID());
        player.setDisplayName("Tester");

        opponent = new Player();
        opponent.setId(UUID.randomUUID());
        opponent.setDisplayName("Opponent");

        plains = new Card("oracle-plains", "Plains", "Common", OwnershipType.UNLIMITED,
                "M19", 0, "Basic Land — Plains", "W", null, true, "Library", 10.0);
        counterspell = new Card("oracle-counter", "Counterspell", "Common", OwnershipType.UNLOCK,
                "M19", 2, "Instant", "U", null, true, "Building B", 5.0);
        blackLotus = new Card("oracle-lotus", "Black Lotus", "Mythic", OwnershipType.UNIQUE,
                "LEA", 0, "Artifact", "", null, false, "Special", 0.1);
        plains.setId(UUID.randomUUID());
        counterspell.setId(UUID.randomUUID());
        blackLotus.setId(UUID.randomUUID());
    }

    @Test
    void ownedCardIdsCombinesUnlimitedUnlockAndUnique() {
        when(cardRepository.findByOwnershipType(OwnershipType.UNLIMITED)).thenReturn(List.of(plains));
        when(unlockRepository.findByPlayer(player)).thenReturn(List.of(new PlayerUnlock(player, counterspell)));
        when(uniqueCardRepository.findByOwner(player)).thenReturn(List.of(new UniqueCard(
                UUID.randomUUID(), player, blackLotus, 1, "claimed")));

        var ids = metrics.ownedCardIds(player);

        assertThat(ids).containsExactlyInAnyOrder(plains.getId(), counterspell.getId(), blackLotus.getId());
    }

    @Test
    void battleStatsCountsCompletedAndConcededMatches() {
        Match win = completed(opponent, player, player.getId());
        Match loss = completed(player, opponent, opponent.getId());
        Match pending = new Match(player, null, opponent, null);
        when(matchRepository.findByPlayer1IdOrPlayer2Id(player.getId(), player.getId()))
                .thenReturn(List.of(win, loss, pending));

        PlayerMetrics.BattleStats stats = metrics.battleStats(player);

        assertThat(stats.played()).isEqualTo(2);
        assertThat(stats.wins()).isEqualTo(1);
        assertThat(stats.losses()).isEqualTo(1);
        assertThat(stats.winRatePercent()).isEqualTo(50);
    }

    @Test
    void battleStatsWithNoMatchesIsZero() {
        when(matchRepository.findByPlayer1IdOrPlayer2Id(player.getId(), player.getId())).thenReturn(List.of());

        PlayerMetrics.BattleStats stats = metrics.battleStats(player);

        assertThat(stats.played()).isZero();
        assertThat(stats.wins()).isZero();
        assertThat(stats.winRatePercent()).isZero();
    }

    @Test
    void favoriteColorsCountsLettersFromOwnedCards() {
        when(cardRepository.findByOwnershipType(OwnershipType.UNLIMITED)).thenReturn(List.of(plains));
        when(unlockRepository.findByPlayer(player)).thenReturn(List.of(new PlayerUnlock(player, counterspell)));
        when(uniqueCardRepository.findByOwner(player)).thenReturn(List.of());

        var colors = metrics.favoriteColors(metrics.ownedCardIds(player), List.of(plains, counterspell, blackLotus));

        assertThat(colors).containsExactly("U", "W");
    }

    @Test
    void totalDiscoveriesSumsDiscoveryCounts() {
        Discovery d1 = new Discovery(player, counterspell);
        d1.setCount(3);
        Discovery d2 = new Discovery(player, plains);
        d2.setCount(2);
        when(discoveryRepository.findByPlayer(player)).thenReturn(List.of(d1, d2));

        assertThat(metrics.totalDiscoveries(player)).isEqualTo(5);
    }

    @Test
    void completionPercentRounds() {
        assertThat(metrics.completionPercent(0, 10)).isZero();
        assertThat(metrics.completionPercent(3, 10)).isEqualTo(30);
        assertThat(metrics.completionPercent(10, 10)).isEqualTo(100);
        assertThat(metrics.completionPercent(5, 0)).isZero();
    }

    @Test
    void favoriteColorsSkipsCardsWithNullOrBlankColors() {
        Card colorless = new Card("oracle-null", "Null Card", "Common", OwnershipType.UNLOCK,
                "M19", 2, "Artifact", "", null, true, "Building B", 5.0);
        Card noColors = new Card("oracle-blank", "Blank Card", "Common", OwnershipType.UNLOCK,
                "M19", 2, "Artifact", null, null, true, "Building B", 5.0);
        colorless.setId(UUID.randomUUID());
        noColors.setId(UUID.randomUUID());
        when(unlockRepository.findByPlayer(player))
                .thenReturn(List.of(new PlayerUnlock(player, colorless), new PlayerUnlock(player, noColors)));

        var colors = metrics.favoriteColors(metrics.ownedCardIds(player), List.of(colorless, noColors));

        assertThat(colors).isEmpty();
    }

    private Match completed(Player p1, Player p2, UUID winnerId) {
        Match match = new Match(p1, null, p2, null);
        match.setStatus(Match.MatchStatus.COMPLETED);
        match.setWinnerId(winnerId);
        return match;
    }
}
