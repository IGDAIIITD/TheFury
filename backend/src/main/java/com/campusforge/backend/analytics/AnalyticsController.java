package com.campusforge.backend.analytics;

import com.campusforge.backend.security.PlayerPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1")
public class AnalyticsController {

    private final PlayerStatsService statsService;
    private final LeaderboardService leaderboardService;
    private final AnalyticsService analyticsService;

    public AnalyticsController(PlayerStatsService statsService,
                               LeaderboardService leaderboardService,
                               AnalyticsService analyticsService) {
        this.statsService = statsService;
        this.leaderboardService = leaderboardService;
        this.analyticsService = analyticsService;
    }

    @GetMapping("/players/me/stats")
    public ProfileStatsDto myStats(@AuthenticationPrincipal PlayerPrincipal principal) {
        return statsService.myStats(principal.getPlayer().getId());
    }

    @GetMapping("/analytics/decks")
    public List<PopularDeckDto> popularDecks(@RequestParam(defaultValue = "10") int limit) {
        return analyticsService.popularDecks(limit);
    }

    @GetMapping("/analytics/buildings")
    public List<BuildingActivityDto> activeBuildings(@RequestParam(defaultValue = "10") int limit) {
        return analyticsService.activeBuildings(limit);
    }

    @GetMapping("/leaderboard")
    public LeaderboardResponse leaderboard(
            @AuthenticationPrincipal PlayerPrincipal principal,
            @RequestParam(defaultValue = "level") String metric,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(required = false) String degreeLevel,
            @RequestParam(required = false) String specialization,
            @RequestParam(required = false) String department) {
        return leaderboardService.leaderboard(principal.getPlayer().getId(), metric, limit,
                degreeLevel, specialization, department);
    }
}
