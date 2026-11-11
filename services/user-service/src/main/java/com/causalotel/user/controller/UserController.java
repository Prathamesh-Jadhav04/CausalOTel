package com.causalotel.user.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * M-04: user identifiers are UUID strings end to end. H-02: these endpoints
 * are restricted to ROLE_ADMIN by SecurityConfig.
 */
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final DataSource dataSource;

    public UserController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getUsers() throws SQLException {
        List<Map<String, Object>> users = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT id, username, email, role, created_at, updated_at FROM users");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                users.add(mapUser(rs));
            }
        }
        return ResponseEntity.ok(users);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getUserById(@PathVariable String id) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return ResponseEntity.ok(mapUser(rs));
                }
            }
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found for id: " + id);
    }

    private static Map<String, Object> mapUser(ResultSet rs) throws SQLException {
        Map<String, Object> u = new HashMap<>();
        u.put("id", rs.getString("id"));
        u.put("username", rs.getString("username"));
        u.put("email", rs.getString("email"));
        u.put("role", rs.getString("role"));
        u.put("created_at", rs.getLong("created_at"));
        long updatedAt = rs.getLong("updated_at");
        u.put("updated_at", rs.wasNull() ? null : updatedAt);
        return u;
    }
}
