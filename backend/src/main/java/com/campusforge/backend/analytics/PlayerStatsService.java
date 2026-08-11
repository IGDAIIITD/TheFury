package com.campusforge.backend.analytics;

import com.campusforge.backend.accounts.AuthService;
import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.achievements.AchievementService;
import com.campusforge.backend.collection.CardRepository;
import com.campusforge.backend.common.ResourceNotFoundException;
import com.campusforge.backend.qr.Claim;
import com.campusforge.backend.qr.ClaimRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class PlayerStatsService {

    private final PlayerRepository playerRepository;
    private final CardRepository cardRepository;
    private final PlayerMetrics metrics;
    private final AchievementService achievementService;
    private final ClaimRepository claimRepository;

    public PlayerStatsService(PlayerRepository playerRepository,
                              CardRepository cardRepository,
                              PlayerMetrics metrics,
                              AchievementService achievementService,
                              ClaimRepository claimRepository) {
        this.playerRepository = playerRepository;
        this.cardRepository = cardRepository;
        this.metrics = metrics;
        this.achievementService = achievementService;
        this.claimRepository = claimRepository;
    }

    @Transactional(readOnly = true)
    public ProfileStatsDto myStats(UUID playerId) {
        Player player = playerRepository.findById(playerId)
                .orElseThrow(() -> new ResourceNotFoundException("Player not found: " + playerId));

        int level = metrics.levelFor(player);
        long xpToNext = metrics.experienceToNextLevel(player);
        long totalDiscoveries = metrics.totalDiscoveries(player);
        Set<UUID> ownedIds = metrics.ownedCardIds(player);
        long totalCards = cardRepository.count();
        int completion = metrics.completionPercent(ownedIds.size(), totalCards);
        List<String> favoriteColors = metrics.favoriteColors(ownedIds, cardRepository.findAll());
        List<String> buildingsVisited = buildingsVisited(playerId);
        PlayerMetrics.BattleStats battleStats = metrics.battleStats(player);

        achievementService.unlockFor(playerId);
        List<ProfileStatsDto.BadgeDto> badges = achievementService.badgesFor(playerId);

        return new ProfileStatsDto(
                AuthService.toPlayerResponse(player),
                player.getExperience(),
                level,
                xpToNext,
                completion,
                ownedIds.size(),
                totalCards,
                totalDiscoveries,
                favoriteColors,
                buildingsVisited,
                new ProfileStatsDto.BattleStatsDto(
                        battleStats.played(), battleStats.wins(), battleStats.losses(), battleStats.winRatePercent()),
                badges);
    }

    /**
     * Distinct buildings where the player has claimed at least one spawn, sorted
     * alphabetically.
     */
    public List<String> buildingsVisited(UUID playerId) {
        return claimRepository.findByClaimedById(playerId).stream()
                .map(Claim::getBuilding)
                .filter(building -> building != null && !building.isBlank())
                .map(String::trim)
                .distinct()
                .sorted()
                .toList();
    }
}
