package com.campusforge.backend.qr;

import com.campusforge.backend.qr.dto.ClaimDto;
import com.campusforge.backend.qr.dto.MintClaimRequest;
import com.campusforge.backend.security.PlayerPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/admin/claims")
public class AdminClaimController {

    private final ClaimService claimService;

    public AdminClaimController(ClaimService claimService) {
        this.claimService = claimService;
    }

    @PostMapping
    public ResponseEntity<List<ClaimDto>> mint(@AuthenticationPrincipal PlayerPrincipal principal,
                                               @Valid @RequestBody MintClaimRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(claimService.mint(request, principal.getPlayer()));
    }

    @GetMapping
    public ResponseEntity<List<ClaimDto>> list(@RequestParam(required = false) ClaimStatus status) {
        return ResponseEntity.ok(claimService.list(status));
    }
}
