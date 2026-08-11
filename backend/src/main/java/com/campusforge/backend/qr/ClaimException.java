package com.campusforge.backend.qr;

import org.springframework.http.HttpStatus;

/**
 * Claim flow error carrying the HTTP status the controller should return.
 * Handled locally by {@link com.campusforge.backend.qr.ClaimController}.
 */
public class ClaimException extends RuntimeException {

    private final HttpStatus status;

    public ClaimException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
