package com.campusforge.backend.analytics;

import com.campusforge.backend.battle.Match;
import com.campusforge.backend.battle.MatchRepository;
import com.campusforge.backend.qr.Claim;
import com.campusforge.backend.qr.ClaimRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Campus-wide analytics: which decks see the most play and which buildings host
 * the most spawn claims. Pure aggregation over already-persisted data.
 */
@Service
public class AnalyticsService {

    private static final int DEFAULT_LIMIT = 10;

    private final MatchRepository matchRepository;
    private final ClaimRepository claimRepository;

    public AnalyticsService(MatchRepository matchRepository, ClaimRepository claimRepository) {
        this.matchRepository = matchRepository;
        this.claimRepository = claimRepository;
    }

    @Transactional(readOnly = true)
    public List<PopularDeckDto> popularDecks(int limit) {
        Map<String, Long> counts = new HashMap<>();
        for (Match match : matchRepository.findAll()) {
            if (match.getStatus() == Match.MatchStatus.PENDING) {
                continue;
            }
            if (match.getDeck1() != null) {
                counts.merge(match.getDeck1().getName(), 1L, Long::sum);
            }
            if (match.getDeck2() != null) {
                counts.merge(match.getDeck2().getName(), 1L, Long::sum);
            }
        }
        return counts.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue(Comparator.reverseOrder())
                        .thenComparing(Map.Entry::getKey))
                .limit(bound(limit))
                .map(e -> new PopularDeckDto(e.getKey(), e.getValue()))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<BuildingActivityDto> activeBuildings(int limit) {
        Map<String, Long> counts = new HashMap<>();
        for (Claim claim : claimRepository.findAll()) {
            String building = claim.getBuilding();
            if (building == null || building.isBlank()) {
                continue;
            }
            counts.merge(building.trim(), 1L, Long::sum);
        }
        return counts.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue(Comparator.reverseOrder())
                        .thenComparing(Map.Entry::getKey))
                .limit(bound(limit))
                .map(e -> new BuildingActivityDto(e.getKey(), e.getValue()))
                .toList();
    }

    private static int bound(int limit) {
        return Math.min(Math.max(limit, 1), 100);
    }
}
