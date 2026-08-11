package com.campusforge.backend.common;

import com.campusforge.backend.accounts.AccountBannedException;
import com.campusforge.backend.deck.InvalidDeckException;
import com.campusforge.backend.events.EventException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.DisabledException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<?> handleNotFound(ResourceNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiError(404, e.getMessage()));
    }

    @ExceptionHandler(EventException.class)
    public ResponseEntity<?> handleEvent(EventException e) {
        return ResponseEntity.status(e.getStatus()).body(new ApiError(e.getStatus().value(), e.getMessage()));
    }

    @ExceptionHandler({AccountBannedException.class, DisabledException.class})
    public ResponseEntity<?> handleBanned(RuntimeException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiError(403, e.getMessage()));
    }

    @ExceptionHandler(InvalidDeckException.class)
    public ResponseEntity<?> handleInvalidDeck(InvalidDeckException e) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                .body(new ApiError(422, "Deck is invalid", e.getProblems()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<?> handleValidation(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .reduce((a, b) -> a + "; " + b)
                .orElse("Validation failed");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new ApiError(400, message));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<?> handleBadRequest(IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new ApiError(400, e.getMessage()));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<?> handleConflict(IllegalStateException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiError(409, e.getMessage()));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<?> handleDataIntegrity(DataIntegrityViolationException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiError(409, "Constraint violation: " + e.getMostSpecificCause().getMessage()));
    }

    public record ApiError(int status, String message, Object details) {
        public ApiError(int status, String message) {
            this(status, message, null);
        }
    }
}
