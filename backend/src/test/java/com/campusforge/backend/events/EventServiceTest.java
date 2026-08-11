package com.campusforge.backend.events;

import com.campusforge.backend.common.events.EventLifecycleEvent;
import com.campusforge.backend.events.dto.CreateEventRequest;
import com.campusforge.backend.events.dto.EventDto;
import com.campusforge.backend.events.dto.UpdateEventRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EventServiceTest {

    @Mock
    EventRepository eventRepository;
    @Mock
    ApplicationEventPublisher publisher;

    EventService service;

    Event activeEvent;

    @BeforeEach
    void setUp() {
        service = new EventService(eventRepository, publisher);
        activeEvent = new Event("Campus Cup", List.of("M19"), new BigDecimal("2.00"),
                LocalDateTime.now().minusDays(1), LocalDateTime.now().plusDays(1));
        activeEvent.setId(UUID.randomUUID());
    }

    @Test
    void listMapsEntitiesToDtos() {
        when(eventRepository.findAllByOrderByStartTimeDesc()).thenReturn(List.of(activeEvent));

        List<EventDto> dtos = service.list();

        assertThat(dtos).hasSize(1);
        assertThat(dtos.get(0).name()).isEqualTo("Campus Cup");
        assertThat(dtos.get(0).allowedSets()).containsExactly("M19");
        assertThat(dtos.get(0).bonusMultiplier()).isEqualByComparingTo("2.00");
    }

    @Test
    void getMissingEventThrowsNotFound() {
        when(eventRepository.findById(any())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.get(UUID.randomUUID()))
                .isInstanceOf(EventException.class)
                .satisfies(e -> assertThat(((EventException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void requireActiveRejectsEndedEvent() {
        activeEvent.setEndTime(LocalDateTime.now().minusHours(1));
        when(eventRepository.findById(activeEvent.getId())).thenReturn(Optional.of(activeEvent));

        assertThatThrownBy(() -> service.requireActive(activeEvent.getId(), LocalDateTime.now()))
                .isInstanceOf(EventException.class)
                .satisfies(e -> assertThat(((EventException) e).getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY));
    }

    @Test
    void requireActiveRejectsInactiveEvent() {
        activeEvent.setActive(false);
        when(eventRepository.findById(activeEvent.getId())).thenReturn(Optional.of(activeEvent));

        assertThatThrownBy(() -> service.requireActive(activeEvent.getId(), LocalDateTime.now()))
                .isInstanceOf(EventException.class)
                .satisfies(e -> assertThat(((EventException) e).getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY));
    }

    @Test
    void createRejectsReversedWindow() {
        CreateEventRequest request = new CreateEventRequest("Bad",
                List.of("M19"), BigDecimal.ONE,
                LocalDateTime.now().plusDays(2), LocalDateTime.now().plusDays(1));

        assertThatThrownBy(() -> service.create(request))
                .isInstanceOf(EventException.class)
                .satisfies(e -> assertThat(((EventException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void createSavesAndPublishesLifecycleWhenLive() {
        CreateEventRequest request = new CreateEventRequest("Campus Cup",
                List.of("M19"), new BigDecimal("2.00"),
                LocalDateTime.now().minusDays(1), LocalDateTime.now().plusDays(1));
        when(eventRepository.save(any(Event.class))).thenAnswer(inv -> inv.getArgument(0));

        EventDto dto = service.create(request);

        assertThat(dto.name()).isEqualTo("Campus Cup");
        assertThat(dto.active()).isTrue();
        verify(eventRepository).save(any(Event.class));
        verify(publisher).publishEvent(any(EventLifecycleEvent.class));
    }

    @Test
    void updateAppliesPartialFields() {
        when(eventRepository.findById(activeEvent.getId())).thenReturn(Optional.of(activeEvent));
        when(eventRepository.save(any(Event.class))).thenAnswer(inv -> inv.getArgument(0));

        EventDto dto = service.update(activeEvent.getId(),
                new UpdateEventRequest("Renamed", null, new BigDecimal("1.50"), null, null, null));

        assertThat(dto.name()).isEqualTo("Renamed");
        assertThat(dto.bonusMultiplier()).isEqualByComparingTo("1.50");
        assertThat(dto.allowedSets()).containsExactly("M19");
    }

    @Test
    void deleteRemovesEvent() {
        when(eventRepository.findById(activeEvent.getId())).thenReturn(Optional.of(activeEvent));

        service.delete(activeEvent.getId());

        verify(eventRepository).delete(activeEvent);
    }

    @Test
    void activeEventReturnsNullWhenNoneLive() {
        when(eventRepository.findActive(any())).thenReturn(List.of());

        assertThat(service.activeEvent(LocalDateTime.now())).isNull();
    }

    @Test
    void activeEventReturnsFirstLiveEvent() {
        Event second = new Event("Second", List.of(), BigDecimal.ONE,
                LocalDateTime.now().minusHours(1), LocalDateTime.now().plusHours(1));
        when(eventRepository.findActive(any())).thenReturn(List.of(activeEvent, second));

        assertThat(service.activeEvent(LocalDateTime.now())).isSameAs(activeEvent);
    }
}
