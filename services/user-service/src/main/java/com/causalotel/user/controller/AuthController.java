package com.causalotel.user.controller;

import com.causalotel.user.dto.BootstrapAdminRequest;
import com.causalotel.user.service.AdminBootstrapService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
public class AuthController {

    private final AdminBootstrapService bootstrapService;

    public AuthController(AdminBootstrapService bootstrapService) {
        this.bootstrapService = bootstrapService;
    }

    @PostMapping("/bootstrap-admin")
    public ResponseEntity<Map<String, Object>> bootstrapAdmin(
            @RequestHeader(value = "X-Bootstrap-Token", required = false) String bootstrapToken,
            @Valid @RequestBody BootstrapAdminRequest request) {

        bootstrapService.bootstrapAdmin(bootstrapToken, request);

        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "status", "SUCCESS",
                "message", "Administrator account provisioned successfully.",
                "username", request.username(),
                "timestamp", Instant.now().toEpochMilli()
        ));
    }
}
