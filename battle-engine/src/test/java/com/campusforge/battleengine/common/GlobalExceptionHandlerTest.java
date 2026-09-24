package com.campusforge.battleengine.common;

import org.junit.jupiter.api.Test;
import org.springframework.beans.TypeMismatchException;
import org.springframework.http.HttpMethod;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import static org.junit.jupiter.api.Assertions.assertEquals;

class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void unknownPathIs404NotA500() {
        assertEquals(404, handler.onException(new NoResourceFoundException(HttpMethod.GET, "ws/match/info")).getStatusCode().value());
    }

    @Test
    void wrongMethodIs405() {
        assertEquals(405, handler.onException(new HttpRequestMethodNotSupportedException("DELETE")).getStatusCode().value());
    }

    @Test
    void badPathValueIs400() {
        assertEquals(400, handler.onBadInput(new TypeMismatchException("not-a-uuid", java.util.UUID.class)).getStatusCode().value());
    }

    @Test
    void realFailuresStay500() {
        assertEquals(500, handler.onException(new RuntimeException("boom")).getStatusCode().value());
    }
}
