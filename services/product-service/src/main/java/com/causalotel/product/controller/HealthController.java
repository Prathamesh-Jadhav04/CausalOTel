package com.causalotel.product.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.Map;

@RestController
@RequestMapping("/health")
public class HealthController {

    private final DataSource dataSource;

    public HealthController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping("/live")
    public ResponseEntity<Map<String, Object>> live() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "product-service"
        ));
    }

    @GetMapping("/ready")
    public ResponseEntity<Map<String, Object>> ready() {
        try (Connection conn = dataSource.getConnection()) {
            boolean valid = conn.isValid(2);
            if (valid) {
                return ResponseEntity.ok(Map.of(
                        "status", "UP",
                        "database", "UP"
                ));
            } else {
                return ResponseEntity.status(503).body(Map.of(
                        "status", "DOWN",
                        "database", "INVALID"
                ));
            }
        } catch (Exception e) {
            return ResponseEntity.status(503).body(Map.of(
                    "status", "DOWN",
                    "database", "ERROR",
                    "error", e.getMessage()
            ));
        }
    }
}
