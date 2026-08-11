package com.campusforge.backend.qr.dto;

import com.campusforge.backend.qr.ClaimStatus;
import jakarta.validation.constraints.NotBlank;

import java.time.LocalDateTime;
import java.util.UUID;

public record ClaimRequest(
        @NotBlank(message = "token is required") String token
) {
}
