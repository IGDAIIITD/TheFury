package com.campusforge.backend.trade;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.collection.OwnershipType;
import com.campusforge.backend.collection.UniqueCard;
import com.campusforge.backend.collection.UniqueCardRepository;
import com.campusforge.backend.trade.dto.CreateTradeRequest;
import com.campusforge.backend.trade.dto.TradeDto;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Live Postgres concurrency proof for atomic trade acceptance.
 * <p>
 * Gated: run only when a real DB is available.
 * {@code mvn test -Dtest=TradeConcurrencyTest -Ddb.integration=true}
 */
@SpringBootTest
@EnabledIfSystemProperty(named = "db.integration", matches = "true")
class TradeConcurrencyTest {

    @Autowired
    TradeService tradeService;
    @Autowired
    TradeRepository tradeRepository;
    @Autowired
    PlayerRepository playerRepository;
    @Autowired
    UniqueCardRepository uniqueCardRepository;
    @Autowired
    CardRepository cardRepository;

    Player playerA;
    Player playerB;
    Card uniqueCard;
    UniqueCard aCard;
    UniqueCard bCard;

    @BeforeEach
    void setUp() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        playerA = player("race-a-" + suffix);
        playerB = player("race-b-" + suffix);
        playerA = playerRepository.save(playerA);
        playerB = playerRepository.save(playerB);

        uniqueCard = cardRepository.save(new Card("race-oracle-" + suffix, "Race Artifact",
                "Mythic", OwnershipType.UNIQUE, "RACE", 0, "Artifact", "", null,
                false, "Special", 0.1));

        aCard = saveUnique(playerA, 1);
        bCard = saveUnique(playerB, 2);
    }

    @AfterEach
    void tearDown() {
        tradeRepository.deleteAll();
        uniqueCardRepository.deleteAll();
        playerRepository.deleteAll(List.of(playerA, playerB));
        cardRepository.deleteAll(List.of(uniqueCard));
    }

    private Player player(String email) {
        Player p = new Player();
        p.setEmail(email + "@campus.edu");
        p.setPasswordHash("$2a$10$unused");
        p.setDisplayName(email);
        p.setStudentId("RACE" + email.substring(email.length() - 4));
        p.setDegreeLevel("B.Tech");
        p.setSpecialization("CSE");
        p.setLevel(1);
        p.setExperience(0);
        return p;
    }

    private UniqueCard saveUnique(Player owner, int serial) {
        UniqueCard uc = new UniqueCard(UUID.randomUUID(), owner, uniqueCard, serial,
                "created: race setup");
        return uniqueCardRepository.save(uc);
    }

    @Test
    void concurrentAcceptsTransferOwnershipExactlyOnce() throws Exception {
        TradeDto created = tradeService.create(playerA.getId(),
                new CreateTradeRequest(playerB.getId(),
                        List.of(aCard.getPhysicalUuid()), List.of(bCard.getPhysicalUuid())));
        UUID tradeId = created.id();

        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<String>> results = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            results.add(pool.submit(() -> {
                start.await();
                try {
                    tradeService.accept(playerB.getId(), tradeId);
                    return "ACCEPTED";
                } catch (TradeException e) {
                    return e.getStatus() == HttpStatus.CONFLICT ? "CONFLICT" : "ERR-" + e.getStatus();
                }
            }));
        }
        start.countDown();
        List<String> statuses = new ArrayList<>();
        for (Future<String> f : results) {
            statuses.add(f.get());
        }
        pool.shutdown();

        assertThat(statuses).contains("ACCEPTED");
        assertThat(statuses).filteredOn(s -> s.equals("ACCEPTED")).hasSize(1);
        assertThat(statuses).filteredOn(s -> s.equals("CONFLICT")).hasSize(threads - 1);

        TradeDto finalTrade = tradeService.get(playerB.getId(), tradeId);
        assertThat(finalTrade.status()).isEqualTo(TradeStatus.ACCEPTED);

        UniqueCard aNow = uniqueCardRepository.findById(aCard.getPhysicalUuid()).orElseThrow();
        UniqueCard bNow = uniqueCardRepository.findById(bCard.getPhysicalUuid()).orElseThrow();
        assertThat(aNow.getOwner().getId()).isEqualTo(playerB.getId());
        assertThat(bNow.getOwner().getId()).isEqualTo(playerA.getId());
        assertThat(aNow.getHistory().split("via trade", -1).length - 1).isEqualTo(1);
        assertThat(bNow.getHistory().split("via trade", -1).length - 1).isEqualTo(1);
    }

    @Test
    void concurrentOffersOfSameCardFailOnOwnershipRecheck() throws Exception {
        UUID freeCard = uniqueCardRepository.save(saveUnique(playerA, 3)).getPhysicalUuid();
        UUID receiverFree = uniqueCardRepository.save(saveUnique(playerB, 4)).getPhysicalUuid();

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<String>> results = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            final int idx = i;
            results.add(pool.submit(() -> {
                start.await();
                try {
                    TradeDto t = tradeService.create(playerA.getId(),
                            new CreateTradeRequest(playerB.getId(), List.of(freeCard), List.of(receiverFree)));
                    tradeService.accept(playerB.getId(), t.id());
                    return "TRADED-" + idx;
                } catch (TradeException e) {
                    return "ERR-" + e.getStatus();
                }
            }));
        }
        start.countDown();
        List<String> statuses = new ArrayList<>();
        for (Future<String> f : results) {
            statuses.add(f.get());
        }
        pool.shutdown();

        assertThat(statuses).filteredOn(s -> s.startsWith("TRADED")).hasSize(1);
        assertThat(statuses).filteredOn(s -> s.startsWith("ERR")).hasSize(1);

        UniqueCard freeNow = uniqueCardRepository.findById(freeCard).orElseThrow();
        assertThat(freeNow.getOwner().getId()).isEqualTo(playerB.getId());
    }
}
