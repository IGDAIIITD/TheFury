package com.campusforge.backend.trade;

import com.campusforge.backend.security.PlayerPrincipal;
import com.campusforge.backend.trade.dto.CreateTradeRequest;
import com.campusforge.backend.trade.dto.TradeDto;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/trades")
public class TradeController {

    private final TradeService tradeService;

    public TradeController(TradeService tradeService) {
        this.tradeService = tradeService;
    }

    @PostMapping
    public ResponseEntity<TradeDto> create(@AuthenticationPrincipal PlayerPrincipal principal,
                                           @Valid @RequestBody CreateTradeRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(tradeService.create(principal.getPlayer().getId(), request));
    }

    @GetMapping("/incoming")
    public List<TradeDto> incoming(@AuthenticationPrincipal PlayerPrincipal principal) {
        return tradeService.incoming(principal.getPlayer().getId());
    }

    @GetMapping("/outgoing")
    public List<TradeDto> outgoing(@AuthenticationPrincipal PlayerPrincipal principal) {
        return tradeService.outgoing(principal.getPlayer().getId());
    }

    @GetMapping("/{tradeId}")
    public TradeDto get(@AuthenticationPrincipal PlayerPrincipal principal, @PathVariable UUID tradeId) {
        return tradeService.get(principal.getPlayer().getId(), tradeId);
    }

    @PostMapping("/{tradeId}/accept")
    public TradeDto accept(@AuthenticationPrincipal PlayerPrincipal principal, @PathVariable UUID tradeId) {
        return tradeService.accept(principal.getPlayer().getId(), tradeId);
    }

    @PostMapping("/{tradeId}/decline")
    public TradeDto decline(@AuthenticationPrincipal PlayerPrincipal principal, @PathVariable UUID tradeId) {
        return tradeService.decline(principal.getPlayer().getId(), tradeId);
    }

    @PostMapping("/{tradeId}/cancel")
    public TradeDto cancel(@AuthenticationPrincipal PlayerPrincipal principal, @PathVariable UUID tradeId) {
        return tradeService.cancel(principal.getPlayer().getId(), tradeId);
    }

    @ExceptionHandler(TradeException.class)
    public ResponseEntity<?> handleTrade(TradeException e) {
        return ResponseEntity.status(e.getStatus())
                .body(new ApiError(e.getStatus().value(), e.getMessage()));
    }

    public record ApiError(int status, String message) {
    }
}
