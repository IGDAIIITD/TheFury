package com.campusforge.backend.events;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.battle.Match;
import com.campusforge.backend.battle.MatchManager;
import com.campusforge.backend.battle.MatchRepository;
import com.campusforge.backend.battle.dto.MatchDto;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.collection.OwnershipType;
import com.campusforge.backend.deck.Deck;
import com.campusforge.backend.deck.DeckCard;
import com.campusforge.backend.deck.DeckRepository;
import com.campusforge.backend.deck.Format;
import com.campusforge.backend.deck.FormatRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Live Postgres proof that event matches persist the event and strictly reject
 * off-set decks, while on-set decks are accepted.
 * <p>
 * Gated: {@code mvn test -Dtest=EventMatchIntegrationTest -Ddb.integration=true}
 */
@SpringBootTest
@EnabledIfSystemProperty(named = "db.integration", matches = "true")
class EventMatchIntegrationTest {

    @Autowired
    EventRepository eventRepository;
    @Autowired
    MatchManager matchManager;
    @Autowired
    MatchRepository matchRepository;
    @Autowired
    PlayerRepository playerRepository;
    @Autowired
    CardRepository cardRepository;
    @Autowired
    DeckRepository deckRepository;
    @Autowired
    FormatRepository formatRepository;

    Player playerA;
    Player playerB;
    Card raceCard;
    Card leaCard;
    Format format;
    Event event;

    @BeforeEach
    void setUp() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        playerA = player("event-a-" + suffix);
        playerB = player("event-b-" + suffix);
        playerA = playerRepository.save(playerA);
        playerB = playerRepository.save(playerB);

        format = formatRepository.save(new Format("RACESTD" + suffix, "Race Standard", 60, 60, null, false, false));

        raceCard = cardRepository.save(new Card("race-oracle-" + suffix, "Race Storm",
                "Common", OwnershipType.UNLIMITED, "RACE", 1, "Instant", "", null, true, "Library", 10.0));
        leaCard = cardRepository.save(new Card("lea-oracle-" + suffix, "Lea Relic",
                "Common", OwnershipType.UNLIMITED, "LEA", 1, "Artifact", "", null, true, "Library", 10.0));

        event = eventRepository.save(new Event("IT Event " + suffix, List.of("RACE"), new BigDecimal("2.00"),
                LocalDateTime.now().minusDays(1), LocalDateTime.now().plusDays(1)));
    }

    @AfterEach
    void tearDown() {
        matchRepository.deleteAll(matchRepository.findByPlayer1IdOrPlayer2Id(playerA.getId(), playerB.getId()));
        deckRepository.deleteAll(deckRepository.findByPlayerId(playerA.getId()));
        deckRepository.deleteAll(deckRepository.findByPlayerId(playerB.getId()));
        cardRepository.deleteAll(List.of(raceCard, leaCard));
        List<Format> testFormats = formatRepository.findAll().stream()
                .filter(f -> f.getCode().startsWith("RACESTD"))
                .toList();
        formatRepository.deleteAll(testFormats);
        List<Event> testEvents = eventRepository.findAll().stream()
                .filter(e -> e.getName().startsWith("IT Event "))
                .toList();
        eventRepository.deleteAll(testEvents);
        playerRepository.deleteAll(List.of(playerA, playerB));
    }

    private Player player(String email) {
        Player p = new Player();
        p.setEmail(email + "@campus.edu");
        p.setPasswordHash("$2a$10$unused");
        p.setDisplayName(email);
        p.setStudentId("EVT" + email.substring(email.length() - 4));
        p.setDegreeLevel("B.Tech");
        p.setSpecialization("CSE");
        p.setLevel(1);
        p.setExperience(0);
        return p;
    }

    private Deck deck(Player owner, Card card) {
        Deck deck = new Deck(owner, "IT Deck", format.getCode(), null);
        deck.setCards(List.of(new DeckCard(deck, card, 60)));
        return deckRepository.save(deck);
    }

    @Test
    void onSetDeckCreatesEventMatchAndPersistsEvent() {
        Deck onSet = deck(playerA, raceCard);

        MatchDto dto = MatchDto.from(matchManager.createLobbyMatch(playerA.getId(), onSet.getId(), event.getId()));

        assertThat(dto.eventId()).isEqualTo(event.getId());
        assertThat(dto.eventName()).isEqualTo(event.getName());

        Match stored = matchRepository.findById(dto.id()).orElseThrow();
        assertThat(stored.getEvent().getId()).isEqualTo(event.getId());
    }

    @Test
    void offSetDeckIsRejectedForEventMatch() {
        Deck offSet = deck(playerA, leaCard);

        assertThatThrownBy(() -> matchManager.createLobbyMatch(playerA.getId(), offSet.getId(), event.getId()))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(matchRepository.findByPlayer1IdOrPlayer2Id(playerA.getId(), playerB.getId())).isEmpty();
    }

    @Test
    void expiredEventIsRejected() {
        Deck onSet = deck(playerA, raceCard);
        event.setEndTime(LocalDateTime.now().minusHours(1));
        eventRepository.save(event);

        assertThatThrownBy(() -> matchManager.createLobbyMatch(playerA.getId(), onSet.getId(), event.getId()))
                .isInstanceOf(EventException.class);
    }
}
