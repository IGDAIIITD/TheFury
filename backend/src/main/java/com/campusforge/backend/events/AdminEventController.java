package com.campusforge.backend.events;

import com.campusforge.backend.events.dto.CreateEventRequest;
import com.campusforge.backend.events.dto.EventDto;
import com.campusforge.backend.events.dto.UpdateEventRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin/events")
public class AdminEventController {

    private final EventService eventService;

    public AdminEventController(EventService eventService) {
        this.eventService = eventService;
    }

    @PostMapping
    public ResponseEntity<EventDto> create(@Valid @RequestBody CreateEventRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(eventService.create(request));
    }

    @GetMapping
    public ResponseEntity<List<EventDto>> list() {
        return ResponseEntity.ok(eventService.list());
    }

    @GetMapping("/{id}")
    public ResponseEntity<EventDto> get(@PathVariable UUID id) {
        return ResponseEntity.ok(eventService.get(id));
    }

    @PutMapping("/{id}")
    public ResponseEntity<EventDto> update(@PathVariable UUID id, @Valid @RequestBody UpdateEventRequest request) {
        return ResponseEntity.ok(eventService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        eventService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
