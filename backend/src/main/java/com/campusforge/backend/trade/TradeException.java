package com.campusforge.backend.trade;

import org.springframework.http.HttpStatus;

/**
 * Trade flow error carrying the HTTP status the controller should return.
 */
public class TradeException extends RuntimeException {

    private final HttpStatus status;

    public TradeException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
