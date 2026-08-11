package com.campusforge.backend.analytics;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.battle.Match;
import com.campusforge.backend.battle.MatchRepository;
import com.campusforge.backend.collection.Card;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.collection.DiscoveryRepository;
import com.campusforge.backend.collection.OwnershipType;
import com.campusforge.backend.collection.PlayerUnlockRepository;
import com.campusforge.backend.collection.UniqueCardRepository;
import com.campusforge.backend.common.LevelService;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Shared player metrics used by the profile stats and leaderboard endpoints. */
@Component
public class PlayerMetrics {

    private final CardRepository cardRepository;
    private final PlayerUnlockRepository unlockRepository;
    private final UniqueCardRepository uniqueCardRepository;
    private final DiscoveryRepository discoveryRepository;
    private final MatchRepository matchRepository;

    public PlayerMetrics(CardRepository cardRepository,
                         PlayerUnlockRepository unlockRepository,
                         UniqueCardRepository uniqueCardRepository,
                         DiscoveryRepository discoveryRepository,
                         MatchRepository matchRepository) {
        this.cardRepository = cardRepository;
        this.unlockRepository = unlockRepository;
        this.uniqueCardRepository = uniqueCardRepository;
        this.discoveryRepository = discoveryRepository;
        this.matchRepository = matchRepository;
    }

    public int levelFor(Player player) {
        return LevelService.levelFor(player.getExperience());
    }

    public long experienceToNextLevel(Player player) {
        long current = player.getExperience();
        long next = (LevelService.levelFor(current)) * (long) LevelService.XP_PER_LEVEL;
        return Math.max(0, next - current);
    }

    public long totalDiscoveries(Player player) {
        return discoveryRepository.findByPlayer(player).stream()
                .mapToLong(d -> d.getCount())
                .sum();
    }

    public Set<UUID> ownedCardIds(Player player) {
        Set<UUID> ids = new HashSet<>();
        cardRepository.findByOwnershipType(OwnershipType.UNLIMITED).forEach(c -> ids.add(c.getId()));
        unlockRepository.findByPlayer(player).forEach(u -> ids.add(u.getCard().getId()));
        uniqueCardRepository.findByOwner(player).forEach(u -> ids.add(u.getCard().getId()));
        return ids;
    }

    public int completionPercent(int ownedCount, long totalCount) {
        return totalCount == 0 ? 0 : (int) Math.round(100.0 * ownedCount / totalCount);
    }

    public List<String> favoriteColors(Set<UUID> ownedCardIds, List<Card> allCards) {
        Map<String, Long> counts = new HashMap<>();
        for (Card card : allCards) {
            if (!ownedCardIds.contains(card.getId())) {
                continue;
            }
            String colors = card.getColors();
            if (colors == null || colors.isBlank()) {
                continue;
            }
            for (char c : colors.toUpperCase().toCharArray()) {
                if ("WUBRG".indexOf(c) >= 0) {
                    counts.merge(String.valueOf(c), 1L, Long::sum);
                }
            }
        }
        return counts.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed()
                        .thenComparing(Map.Entry::getKey))
                .limit(3)
                .map(Map.Entry::getKey)
                .toList();
    }

    public BattleStats battleStats(Player player) {
        List<Match> matches = matchRepository.findByPlayer1IdOrPlayer2Id(player.getId(), player.getId());
        int played = 0;
        int wins = 0;
        for (Match match : matches) {
            if (match.getStatus() != Match.MatchStatus.COMPLETED
                    && match.getStatus() != Match.MatchStatus.CONCEDED) {
                continue;
            }
            played++;
            if (player.getId().equals(match.getWinnerId())) {
                wins++;
            }
        }
        int winRate = played == 0 ? 0 : (int) Math.round(100.0 * wins / played);
        return new BattleStats(played, wins, played - wins, winRate);
    }

    public record BattleStats(int played, int wins, int losses, int winRatePercent) {
    }
}
