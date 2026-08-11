package com.campusforge.backend.deck;

import com.campusforge.backend.security.PlayerPrincipal;
import com.campusforge.backend.deck.dto.CreateDeckRequest;
import com.campusforge.backend.deck.dto.DeckDto;
import com.campusforge.backend.deck.dto.DeckListResponse;
import com.campusforge.backend.deck.dto.DeckValidationResult;
import com.campusforge.backend.deck.dto.ValidateDeckRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
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
@RequestMapping("/api/v1/decks")
public class DeckController {

    private final DeckService deckService;

    public DeckController(DeckService deckService) {
        this.deckService = deckService;
    }

    @GetMapping
    public DeckListResponse list(@AuthenticationPrincipal PlayerPrincipal principal) {
        List<DeckDto> decks = deckService.list(principal.getPlayer().getId());
        return new DeckListResponse(decks);
    }

    @GetMapping("/{deckId}")
    public DeckDto get(@AuthenticationPrincipal PlayerPrincipal principal, @PathVariable UUID deckId) {
        return deckService.get(principal.getPlayer().getId(), deckId);
    }

    @PostMapping
    public ResponseEntity<DeckDto> create(@AuthenticationPrincipal PlayerPrincipal principal,
                                          @Valid @RequestBody CreateDeckRequest request) {
        DeckDto deck = deckService.create(principal.getPlayer().getId(), request);
        return ResponseEntity.status(HttpStatus.CREATED).body(deck);
    }

    @PutMapping("/{deckId}")
    public DeckDto update(@AuthenticationPrincipal PlayerPrincipal principal,
                          @PathVariable UUID deckId,
                          @Valid @RequestBody CreateDeckRequest request) {
        return deckService.update(principal.getPlayer().getId(), deckId, request);
    }

    @DeleteMapping("/{deckId}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal PlayerPrincipal principal,
                                       @PathVariable UUID deckId) {
        deckService.delete(principal.getPlayer().getId(), deckId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/validate")
    public DeckValidationResult validate(@AuthenticationPrincipal PlayerPrincipal principal,
                                         @Valid @RequestBody ValidateDeckRequest request) {
        DeckValidationService.DeckValidation result = deckService.validateDraft(principal.getPlayer().getId(), request);
        if (result.valid()) {
            return DeckValidationResult.ok();
        }
        List<com.campusforge.backend.deck.dto.DeckProblemDto> problemDtos = result.problems().stream()
                .map(p -> new com.campusforge.backend.deck.dto.DeckProblemDto(p.code(), p.message(), p.cardId()))
                .toList();
        return DeckValidationResult.invalid(problemDtos);
    }
}
