package com.campusforge.backend.events;

import com.campusforge.backend.events.dto.EventDto;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/events")
public class EventController {

    private final EventService eventService;

    public EventController(EventService eventService) {
        this.eventService = eventService;
    }

    @GetMapping
    public ResponseEntity<List<EventDto>> list() {
        return ResponseEntity.ok(eventService.list());
    }

    @GetMapping("/active")
    public ResponseEntity<List<EventDto>> active() {
        return ResponseEntity.ok(eventService.listActive(LocalDateTime.now()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<EventDto> get(@PathVariable UUID id) {
        return ResponseEntity.ok(eventService.get(id));
    }
}
