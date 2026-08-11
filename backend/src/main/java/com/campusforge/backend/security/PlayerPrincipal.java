package com.campusforge.backend.security;

import com.campusforge.backend.accounts.Player;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;

public class PlayerPrincipal implements UserDetails {

    private final Player player;

    public PlayerPrincipal(Player player) {
        this.player = player;
    }

    public Player getPlayer() {
        return player;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority(player.getRole()));
    }

    @Override
    public String getPassword() {
        return player.getPasswordHash();
    }

    @Override
    public String getUsername() {
        return player.getEmail();
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return !player.isBanned();
    }
}
