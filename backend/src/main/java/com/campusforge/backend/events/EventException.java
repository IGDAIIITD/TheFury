package com.campusforge.backend.events;

import org.springframework.http.HttpStatus;

public class EventException extends RuntimeException {

    private final HttpStatus status;

    public EventException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
