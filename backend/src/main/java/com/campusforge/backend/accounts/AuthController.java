package com.campusforge.backend.accounts;

import com.campusforge.backend.accounts.dto.AuthResponse;
import com.campusforge.backend.accounts.dto.LoginRequest;
import com.campusforge.backend.accounts.dto.RegisterRequest;
import com.campusforge.backend.security.PlayerPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(authService.register(request));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(authService.login(request));
    }

    @GetMapping("/me")
    public ResponseEntity<AuthResponse.PlayerResponse> me(@AuthenticationPrincipal PlayerPrincipal principal) {
        return ResponseEntity.ok(AuthService.toPlayerResponse(principal.getPlayer()));
    }

    @ExceptionHandler(EmailAlreadyInUseException.class)
    public ResponseEntity<?> handleEmailInUse(EmailAlreadyInUseException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiError(409, e.getMessage()));
    }

    @ExceptionHandler(InvalidCredentialsException.class)
    public ResponseEntity<?> handleInvalidCredentials(InvalidCredentialsException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ApiError(401, e.getMessage()));
    }

    public record ApiError(int status, String message) {
    }
}
