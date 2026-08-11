package com.campusforge.backend.admin;

import com.campusforge.backend.admin.dto.AdminPlayerDto;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin/players")
public class AdminPlayerController {

    private final AdminPlayerService adminPlayerService;

    public AdminPlayerController(AdminPlayerService adminPlayerService) {
        this.adminPlayerService = adminPlayerService;
    }

    @GetMapping
    public ResponseEntity<List<AdminPlayerDto>> list(@RequestParam(required = false) String q) {
        return ResponseEntity.ok(adminPlayerService.list(q));
    }

    @PostMapping("/{id}/ban")
    public ResponseEntity<AdminPlayerDto> ban(@PathVariable UUID id) {
        return ResponseEntity.ok(adminPlayerService.ban(id));
    }

    @PostMapping("/{id}/unban")
    public ResponseEntity<AdminPlayerDto> unban(@PathVariable UUID id) {
        return ResponseEntity.ok(adminPlayerService.unban(id));
    }

    @PostMapping("/{id}/role")
    public ResponseEntity<AdminPlayerDto> setRole(@PathVariable UUID id, @RequestBody Map<String, String> body) {
        return ResponseEntity.ok(adminPlayerService.setRole(id, body.get("role")));
    }
}
