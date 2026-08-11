package com.campusforge.backend.analytics;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.common.Cohort;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class LeaderboardService {

    private final PlayerRepository playerRepository;
    private final CardRepository cardRepository;
    private final PlayerMetrics metrics;

    public LeaderboardService(PlayerRepository playerRepository,
                              CardRepository cardRepository,
                              PlayerMetrics metrics) {
        this.playerRepository = playerRepository;
        this.cardRepository = cardRepository;
        this.metrics = metrics;
    }

    public LeaderboardResponse leaderboard(UUID myPlayerId, String metric, int limit,
                                           String degreeLevel, String specialization, String department) {
        List<Candidate> candidates = new ArrayList<>();
        long totalCards = cardRepository.count();

        for (Player player : playerRepository.findAll()) {
            if (!matchesCohort(player, degreeLevel, specialization, department)) {
                continue;
            }
            int score;
            long value;
            switch (metric) {
                case "collection" -> {
                    Set<UUID> owned = metrics.ownedCardIds(player);
                    score = metrics.completionPercent(owned.size(), totalCards);
                    value = owned.size();
                }
                case "winrate" -> {
                    PlayerMetrics.BattleStats battle = metrics.battleStats(player);
                    score = battle.winRatePercent();
                    value = battle.wins();
                }
                default -> {
                    score = metrics.levelFor(player);
                    value = player.getExperience();
                }
            }
            candidates.add(new Candidate(player, score, value));
        }

        candidates.sort(Comparator.comparingInt(Candidate::score).reversed()
                .thenComparing(Comparator.comparingLong(Candidate::value).reversed())
                .thenComparing(c -> c.player().getDisplayName()));

        int max = Math.min(Math.max(limit, 1), 100);
        List<LeaderboardResponse.LeaderboardRowDto> rows = new ArrayList<>();
        Integer myRank = null;
        for (int i = 0; i < candidates.size(); i++) {
            Candidate c = candidates.get(i);
            rows.add(new LeaderboardResponse.LeaderboardRowDto(
                    i + 1, c.player().getId(), c.player().getDisplayName(), c.player().getAvatar(),
                    c.player().getDegreeLevel(), c.player().getSpecialization(), c.score(), c.value()));
            if (c.player().getId().equals(myPlayerId)) {
                myRank = i + 1;
            }
            if (rows.size() >= max) {
                break;
            }
        }
        return new LeaderboardResponse(rows, myRank);
    }

    private boolean matchesCohort(Player player, String degreeLevel, String specialization, String department) {
        if (!isBlank(degreeLevel) && !degreeLevel.equalsIgnoreCase(player.getDegreeLevel())) {
            return false;
        }
        if (!isBlank(specialization) && !specialization.equalsIgnoreCase(player.getSpecialization())) {
            return false;
        }
        if (!isBlank(department) && !department.equalsIgnoreCase(Cohort.departmentOf(player.getSpecialization()))) {
            return false;
        }
        return true;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private record Candidate(Player player, int score, long value) {
    }
}
