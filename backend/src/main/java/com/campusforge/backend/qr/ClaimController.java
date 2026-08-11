package com.campusforge.backend.qr;

import com.campusforge.backend.qr.dto.ClaimRequest;
import com.campusforge.backend.qr.dto.ClaimResultDto;
import com.campusforge.backend.security.PlayerPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/claim")
public class ClaimController {

    private final ClaimService claimService;

    public ClaimController(ClaimService claimService) {
        this.claimService = claimService;
    }

    @PostMapping
    public ResponseEntity<ClaimResultDto> claim(@AuthenticationPrincipal PlayerPrincipal principal,
                                                @Valid @RequestBody ClaimRequest request) {
        return ResponseEntity.ok(claimService.claim(principal.getPlayer().getId(), request.token().trim()));
    }

    @ExceptionHandler(ClaimException.class)
    public ResponseEntity<?> handleClaim(ClaimException e) {
        return ResponseEntity.status(e.getStatus())
                .body(new ApiError(e.getStatus().value(), e.getMessage()));
    }

    public record ApiError(int status, String message) {
    }
}
