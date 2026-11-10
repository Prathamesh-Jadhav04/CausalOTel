package com.causalotel.user.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Instant;
import java.util.Map;

@RestController
public class HealthController {

    private final DataSource dataSource;

    public HealthController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping("/health/live")
    public ResponseEntity<Map<String, Object>> getLiveness() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "user-service",
                "timestamp", Instant.now().toEpochMilli()
        ));
    }

    @GetMapping("/health/ready")
    public ResponseEntity<Map<String, Object>> getReadiness() {
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {
            stmt.execute("SELECT 1;");
            return ResponseEntity.ok(Map.of(
                    "status", "UP",
                    "database", "CONNECTED",
                    "storage", "DURABLE_SQLITE",
                    "timestamp", Instant.now().toEpochMilli()
            ));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
                    "status", "DOWN",
                    "database", "DISCONNECTED",
                    "timestamp", Instant.now().toEpochMilli()
            ));
        }
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> getHealth() {
        return getReadiness();
    }
}
