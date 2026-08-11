package com.campusforge.backend.accounts;

import com.campusforge.backend.accounts.dto.AuthResponse;
import com.campusforge.backend.accounts.dto.LoginRequest;
import com.campusforge.backend.accounts.dto.RegisterRequest;
import com.campusforge.backend.common.Cohort;
import com.campusforge.backend.security.JwtService;
import com.campusforge.backend.starter.StarterDeckService;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

    private final PlayerRepository playerRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuthenticationManager authenticationManager;
    private final StarterDeckService starterDeckService;

    public AuthService(PlayerRepository playerRepository,
                       PasswordEncoder passwordEncoder,
                       JwtService jwtService,
                       AuthenticationManager authenticationManager,
                       StarterDeckService starterDeckService) {
        this.playerRepository = playerRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.authenticationManager = authenticationManager;
        this.starterDeckService = starterDeckService;
    }

    public AuthResponse register(RegisterRequest request) {
        if (playerRepository.existsByEmail(request.email())) {
            throw new EmailAlreadyInUseException(request.email());
        }
        if (!Cohort.isValid(request.degreeLevel(), request.specialization())) {
            throw new IllegalArgumentException(
                    "Invalid degree level or specialization for that degree");
        }

        Player player = new Player();
        player.setEmail(request.email().toLowerCase());
        player.setPasswordHash(passwordEncoder.encode(request.password()));
        player.setDisplayName(request.displayName());
        player.setStudentId(request.studentId());
        player.setDegreeLevel(request.degreeLevel().toUpperCase());
        player.setSpecialization(request.specialization().toUpperCase());

        player = playerRepository.save(player);
        starterDeckService.provision(player);
        String token = jwtService.generateToken(player.getId(), player.getEmail());
        return toResponse(player, token);
    }

    public AuthResponse login(LoginRequest request) {
        try {
            authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(request.email().toLowerCase(), request.password()));
        } catch (BadCredentialsException e) {
            throw new InvalidCredentialsException();
        }

        Player player = playerRepository.findByEmail(request.email().toLowerCase())
                .orElseThrow(InvalidCredentialsException::new);
        if (player.isBanned()) {
            throw new AccountBannedException("Account is banned");
        }
        player.setLastLogin(java.time.LocalDateTime.now());
        playerRepository.save(player);

        String token = jwtService.generateToken(player.getId(), player.getEmail());
        return toResponse(player, token);
    }

    public static AuthResponse.PlayerResponse toPlayerResponse(Player player) {
        return new AuthResponse.PlayerResponse(
                player.getId(),
                player.getEmail(),
                player.getDisplayName(),
                player.getRole(),
                player.getAvatar(),
                player.getStudentId(),
                player.getDegreeLevel(),
                player.getSpecialization(),
                player.getExperience(),
                player.getLevel());
    }

    private AuthResponse toResponse(Player player, String token) {
        return new AuthResponse(token, AuthResponse.BEARER, toPlayerResponse(player));
    }
}
