package com.campusforge.backend.admin;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import com.campusforge.backend.admin.dto.AdminPlayerDto;
import com.campusforge.backend.common.ResourceNotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class AdminPlayerService {

    private static final String ROLE_PLAYER = "ROLE_PLAYER";
    private static final String ROLE_ADMIN = "ROLE_ADMIN";

    private final PlayerRepository playerRepository;

    public AdminPlayerService(PlayerRepository playerRepository) {
        this.playerRepository = playerRepository;
    }

    @Transactional(readOnly = true)
    public List<AdminPlayerDto> list(String query) {
        List<Player> players = new ArrayList<>();
        if (query == null || query.isBlank()) {
            players = playerRepository.findAll();
        } else {
            players.addAll(playerRepository.findTop10ByDisplayNameContainingIgnoreCase(query.trim()));
            for (Player p : playerRepository.findTop10ByEmailContainingIgnoreCase(query.trim())) {
                if (players.stream().noneMatch(x -> x.getId().equals(p.getId()))) {
                    players.add(p);
                }
            }
        }
        return players.stream().map(AdminPlayerDto::from).toList();
    }

    @Transactional
    public AdminPlayerDto ban(UUID playerId) {
        Player player = require(playerId);
        player.setBanned(true);
        player.setBannedAt(LocalDateTime.now());
        return AdminPlayerDto.from(playerRepository.save(player));
    }

    @Transactional
    public AdminPlayerDto unban(UUID playerId) {
        Player player = require(playerId);
        player.setBanned(false);
        player.setBannedAt(null);
        return AdminPlayerDto.from(playerRepository.save(player));
    }

    @Transactional
    public AdminPlayerDto setRole(UUID playerId, String role) {
        if (role == null || !(ROLE_PLAYER.equals(role) || ROLE_ADMIN.equals(role))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "role must be one of " + ROLE_PLAYER + ", " + ROLE_ADMIN);
        }
        Player player = require(playerId);
        player.setRole(role);
        return AdminPlayerDto.from(playerRepository.save(player));
    }

    private Player require(UUID playerId) {
        return playerRepository.findById(playerId)
                .orElseThrow(() -> new ResourceNotFoundException("Player not found: " + playerId));
    }
}
