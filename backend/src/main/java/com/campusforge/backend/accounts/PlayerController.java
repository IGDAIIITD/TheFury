package com.campusforge.backend.accounts;

import com.campusforge.backend.accounts.dto.PlayerSummaryDto;
import com.campusforge.backend.collection.UniqueCardRepository;
import com.campusforge.backend.collection.dto.UniqueCardDto;
import com.campusforge.backend.common.ResourceNotFoundException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/players")
public class PlayerController {

    private final PlayerRepository playerRepository;
    private final UniqueCardRepository uniqueCardRepository;

    public PlayerController(PlayerRepository playerRepository,
                            UniqueCardRepository uniqueCardRepository) {
        this.playerRepository = playerRepository;
        this.uniqueCardRepository = uniqueCardRepository;
    }

    @GetMapping("/search")
    public List<PlayerSummaryDto> search(@RequestParam(required = false) String q) {
        if (q == null || q.isBlank()) {
            return List.of();
        }
        String term = q.trim();
        Map<UUID, PlayerSummaryDto> byId = new LinkedHashMap<>();
        for (Player p : playerRepository.findTop10ByDisplayNameContainingIgnoreCase(term)) {
            byId.putIfAbsent(p.getId(), PlayerSummaryDto.from(p));
        }
        for (Player p : playerRepository.findTop10ByEmailContainingIgnoreCase(term)) {
            byId.putIfAbsent(p.getId(), PlayerSummaryDto.from(p));
        }
        return List.copyOf(byId.values());
    }

    @GetMapping("/{playerId}/unique-cards")
    public List<UniqueCardDto> uniqueCards(@PathVariable UUID playerId) {
        Player player = playerRepository.findById(playerId)
                .orElseThrow(() -> new ResourceNotFoundException("Player not found: " + playerId));
        return uniqueCardRepository.findByOwner(player).stream()
                .map(UniqueCardDto::from)
                .toList();
    }
}
