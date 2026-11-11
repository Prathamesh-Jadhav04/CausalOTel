package com.causalotel.user.service;

import com.causalotel.user.dto.LoginRequest;
import com.causalotel.user.dto.RegisterRequest;
import com.causalotel.user.security.TokenService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * H-02: credential verification and token issuance. Registration always
 * creates ROLE_USER; privileged roles can only be provisioned through the
 * one-time bootstrap flow or direct administration.
 */
@Service
public class AuthService {

    private final DataSource dataSource;
    private final PasswordEncoder passwordEncoder;
    private final TokenService tokenService;
    private final long tokenTtlSeconds;

    public AuthService(DataSource dataSource, PasswordEncoder passwordEncoder, TokenService tokenService,
                       @Value("${auth.token.ttl-seconds:3600}") long tokenTtlSeconds) {
        this.dataSource = dataSource;
        this.passwordEncoder = passwordEncoder;
        this.tokenService = tokenService;
        this.tokenTtlSeconds = tokenTtlSeconds;
    }

    public Map<String, Object> register(RegisterRequest request) {
        String username = request.username().trim();
        String email = request.email().trim().toLowerCase(Locale.ROOT);

        try (Connection conn = dataSource.getConnection()) {
            if (exists(conn, username, email)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Username or email is already registered");
            }
            String userId = UUID.randomUUID().toString();
            String passwordHash = passwordEncoder.encode(request.password());
            long now = System.currentTimeMillis();
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO users (id, username, email, password_hash, role, created_at) " +
                            "VALUES (?, ?, ?, ?, 'ROLE_USER', ?)")) {
                ps.setString(1, userId);
                ps.setString(2, username);
                ps.setString(3, email);
                ps.setString(4, passwordHash);
                ps.setLong(5, now);
                ps.executeUpdate();
            }
            Map<String, Object> user = new LinkedHashMap<>();
            user.put("id", userId);
            user.put("username", username);
            user.put("email", email);
            user.put("role", "ROLE_USER");
            user.put("created_at", now);
            return tokenResponse(user);
        } catch (SQLException e) {
            if (String.valueOf(e.getMessage()).toUpperCase(Locale.ROOT).contains("UNIQUE")) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Username or email is already registered");
            }
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to register user", e);
        }
    }

    public Map<String, Object> login(LoginRequest request) {
        String identifier = request.usernameOrEmail().trim();
        String emailCandidate = identifier.toLowerCase(Locale.ROOT);
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT id, username, email, password_hash, role, created_at " +
                             "FROM users WHERE username = ? OR email = ?")) {
            ps.setString(1, identifier);
            ps.setString(2, emailCandidate);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next() || !passwordEncoder.matches(request.password(), rs.getString("password_hash"))) {
                    // Deliberately identical response for unknown users and bad passwords.
                    throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
                }
                Map<String, Object> user = new LinkedHashMap<>();
                user.put("id", rs.getString("id"));
                user.put("username", rs.getString("username"));
                user.put("email", rs.getString("email"));
                user.put("role", rs.getString("role"));
                user.put("created_at", rs.getLong("created_at"));
                return tokenResponse(user);
            }
        } catch (SQLException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to authenticate user", e);
        }
    }

    public Map<String, Object> currentUser(String userId) {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?")) {
            ps.setString(1, userId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User no longer exists");
                }
                Map<String, Object> user = new LinkedHashMap<>();
                user.put("id", rs.getString("id"));
                user.put("username", rs.getString("username"));
                user.put("email", rs.getString("email"));
                user.put("role", rs.getString("role"));
                user.put("created_at", rs.getLong("created_at"));
                long updatedAt = rs.getLong("updated_at");
                user.put("updated_at", rs.wasNull() ? null : updatedAt);
                return user;
            }
        } catch (SQLException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to load current user", e);
        }
    }

    private Map<String, Object> tokenResponse(Map<String, Object> user) {
        String token = tokenService.issue(
                String.valueOf(user.get("id")),
                String.valueOf(user.get("username")),
                String.valueOf(user.get("role")),
                tokenTtlSeconds);
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("token", token);
        response.put("tokenType", "Bearer");
        response.put("expiresIn", tokenTtlSeconds);
        response.put("user", user);
        return response;
    }

    private boolean exists(Connection conn, String username, String email) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT 1 FROM users WHERE username = ? OR email = ?")) {
            ps.setString(1, username);
            ps.setString(2, email);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }
}
