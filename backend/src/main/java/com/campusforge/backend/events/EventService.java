package com.campusforge.backend.events;

import com.campusforge.backend.common.events.EventLifecycleEvent;
import com.campusforge.backend.events.dto.CreateEventRequest;
import com.campusforge.backend.events.dto.EventDto;
import com.campusforge.backend.events.dto.UpdateEventRequest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Service
public class EventService {

    private final EventRepository eventRepository;
    private final ApplicationEventPublisher publisher;

    public EventService(EventRepository eventRepository, ApplicationEventPublisher publisher) {
        this.eventRepository = eventRepository;
        this.publisher = publisher;
    }

    public List<EventDto> list() {
        return eventRepository.findAllByOrderByStartTimeDesc().stream()
                .map(EventDto::from)
                .toList();
    }

    public List<EventDto> listActive(LocalDateTime now) {
        return eventRepository.findActive(now).stream()
                .map(EventDto::from)
                .toList();
    }

    public EventDto get(UUID id) {
        return EventDto.from(require(id));
    }

    public Event require(UUID id) {
        return eventRepository.findById(id)
                .orElseThrow(() -> new EventException(HttpStatus.NOT_FOUND, "Event not found: " + id));
    }

    public Event requireActive(UUID id, LocalDateTime now) {
        Event event = require(id);
        if (!event.isActive() || event.getStartTime().isAfter(now) || event.getEndTime().isBefore(now)) {
            throw new EventException(HttpStatus.UNPROCESSABLE_ENTITY, "Event is not currently active: " + id);
        }
        return event;
    }

    /** Returns the currently active event if any; the first active by start time wins. */
    public Event activeEvent(LocalDateTime now) {
        List<Event> active = eventRepository.findActive(now);
        return active.isEmpty() ? null : active.get(0);
    }

    @Transactional
    public EventDto create(CreateEventRequest request) {
        validateWindow(request.startTime(), request.endTime());
        Event event = new Event(
                request.name().trim(),
                request.allowedSets() == null ? List.of() : request.allowedSets(),
                request.bonusMultiplier() == null ? BigDecimal.ONE : request.bonusMultiplier(),
                request.startTime(),
                request.endTime());
        event = eventRepository.save(event);
        if (event.isActive() && event.getStartTime().isBefore(LocalDateTime.now())) {
            publisher.publishEvent(new EventLifecycleEvent(event.getName(), true, event.getBonusMultiplier()));
        }
        return EventDto.from(event);
    }

    @Transactional
    public EventDto update(UUID id, UpdateEventRequest request) {
        Event event = require(id);
        if (request.name() != null) {
            event.setName(request.name().trim());
        }
        if (request.allowedSets() != null) {
            event.setAllowedSets(request.allowedSets());
        }
        if (request.bonusMultiplier() != null) {
            event.setBonusMultiplier(request.bonusMultiplier());
        }
        LocalDateTime start = request.startTime() == null ? event.getStartTime() : request.startTime();
        LocalDateTime end = request.endTime() == null ? event.getEndTime() : request.endTime();
        validateWindow(start, end);
        event.setStartTime(start);
        event.setEndTime(end);
        if (request.active() != null) {
            event.setActive(request.active());
        }
        event = eventRepository.save(event);
        if (event.isActive() && event.getStartTime().isBefore(LocalDateTime.now())) {
            publisher.publishEvent(new EventLifecycleEvent(event.getName(), true, event.getBonusMultiplier()));
        }
        return EventDto.from(event);
    }

    @Transactional
    public void delete(UUID id) {
        Event event = require(id);
        eventRepository.delete(event);
    }

    private void validateWindow(LocalDateTime start, LocalDateTime end) {
        if (start == null || end == null || !end.isAfter(start)) {
            throw new EventException(HttpStatus.BAD_REQUEST, "Event end time must be after start time");
        }
    }
}
