package com.campusforge.backend.security;

import com.campusforge.backend.accounts.Player;
import com.campusforge.backend.accounts.PlayerRepository;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class PlayerUserDetailsService implements UserDetailsService {

    private final PlayerRepository playerRepository;

    public PlayerUserDetailsService(PlayerRepository playerRepository) {
        this.playerRepository = playerRepository;
    }

    @Override
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        Player player = playerRepository.findByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException("Player not found: " + email));
        if (player.isBanned()) {
            throw new DisabledException("Account is banned");
        }
        return new PlayerPrincipal(player);
    }
}
