package com.campusforge.backend.feed;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/admin/audit")
public class AdminAuditController {

    private final FeedService feedService;

    public AdminAuditController(FeedService feedService) {
        this.feedService = feedService;
    }

    @GetMapping
    public ResponseEntity<List<FeedEntryDto>> audit() {
        return ResponseEntity.ok(feedService.history());
    }
}
