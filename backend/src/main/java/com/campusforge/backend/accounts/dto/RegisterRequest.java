package com.campusforge.backend.accounts.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        @NotBlank @Email String email,
        @NotBlank @Size(min = 8, max = 100) String password,
        @NotBlank @Size(min = 1, max = 50) String displayName,
        String studentId,
        @NotBlank String degreeLevel,
        @NotBlank String specialization
) {
}
