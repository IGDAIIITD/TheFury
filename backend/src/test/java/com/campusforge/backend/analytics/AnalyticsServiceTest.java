package com.campusforge.backend.analytics;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.battle.Match;
import com.campusforge.backend.battle.MatchRepository;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.OwnershipType;
import com.campusforge.backend.deck.Deck;
import com.campusforge.backend.qr.Claim;
import com.campusforge.backend.qr.ClaimRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AnalyticsServiceTest {

    @Mock
    MatchRepository matchRepository;
    @Mock
    ClaimRepository claimRepository;

    AnalyticsService service;

    Player alice;
    Player bob;
    Deck rgCombat;
    Deck burn;
    Card card;

    @BeforeEach
    void setUp() {
        service = new AnalyticsService(matchRepository, claimRepository);
        alice = player("alice@campus.edu", "Alice");
        bob = player("bob@campus.edu", "Bob");
        card = new Card("oracle-counter", "Counterspell", "Common", OwnershipType.UNLOCK,
                "M19", 2, "Instant", "U", null, true, "Building B", 5.0);
        card.setId(UUID.randomUUID());
        rgCombat = new Deck(alice, "RG Combat", "standard", null);
        burn = new Deck(bob, "Burn", "standard", null);
    }

    private Player player(String email, String name) {
        Player p = new Player();
        p.setId(UUID.randomUUID());
        p.setEmail(email);
        p.setDisplayName(name);
        return p;
    }

    private Match match(Deck d1, Deck d2, Match.MatchStatus status) {
        Match m = new Match(alice, d1, bob, d2);
        m.setStatus(status);
        return m;
    }

    @Test
    void popularDecksCountsPlayedMatchesByDeckName() {
        when(matchRepository.findAll()).thenReturn(List.of(
                match(rgCombat, burn, Match.MatchStatus.COMPLETED),
                match(burn, rgCombat, Match.MatchStatus.CONCEDED),
                match(rgCombat, rgCombat, Match.MatchStatus.ACTIVE),
                match(rgCombat, burn, Match.MatchStatus.PENDING)));

        List<PopularDeckDto> decks = service.popularDecks(10);

        assertThat(decks).containsExactly(
                new PopularDeckDto("RG Combat", 4),
                new PopularDeckDto("Burn", 2));
    }

    @Test
    void popularDecksIgnoresPendingMatchesAndRespectsLimit() {
        when(matchRepository.findAll()).thenReturn(List.of(
                match(rgCombat, burn, Match.MatchStatus.PENDING),
                match(rgCombat, burn, Match.MatchStatus.COMPLETED)));

        List<PopularDeckDto> decks = service.popularDecks(1);

        assertThat(decks).containsExactly(new PopularDeckDto("Burn", 1));
    }

    @Test
    void activeBuildingsCountsNonBlankBuildings() {
        when(claimRepository.findAll()).thenReturn(List.of(
                claim("Block C"), claim("Block C"), claim("Block A"), claim(null), claim("  ")));

        List<BuildingActivityDto> buildings = service.activeBuildings(10);

        assertThat(buildings).containsExactly(
                new BuildingActivityDto("Block C", 2),
                new BuildingActivityDto("Block A", 1));
    }

    private Claim claim(String building) {
        Claim c = new Claim(UUID.randomUUID().toString().substring(0, 12),
                UUID.randomUUID().toString().substring(0, 12), card, building, LocalDateTime.now());
        return c;
    }
}
