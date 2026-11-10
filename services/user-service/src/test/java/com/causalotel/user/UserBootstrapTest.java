package com.causalotel.user;

import com.causalotel.user.dto.BootstrapAdminRequest;
import com.causalotel.user.service.AdminBootstrapService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class UserBootstrapTest {

    @Autowired
    private AdminBootstrapService bootstrapService;

    @Autowired
    private com.causalotel.user.controller.UserController userController;

    @Autowired
    private DataSource dataSource;

    private final String validToken = "test-token-abcdef1234567890abcdef1234567890";
    private final String validTokenHash = AdminBootstrapService.sha256(validToken);

    @BeforeEach
    void resetDatabase() throws SQLException {
        try (Connection conn = dataSource.getConnection()) {
            conn.createStatement().execute("DELETE FROM users;");
            conn.createStatement().execute("DELETE FROM bootstrap_tokens;");

            long now = Instant.now().toEpochMilli();
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO bootstrap_tokens (id, token_hash, expires_at, created_at, failed_attempts) VALUES (1, ?, ?, ?, 0)")) {
                ps.setString(1, validTokenHash);
                ps.setLong(2, now + 60000); // 1 minute in the future
                ps.setLong(3, now);
                ps.executeUpdate();
            }
        }
    }

    @Test
    @DisplayName("Verify effective PRAGMA settings across multiple pooled connections")
    void testPooledConnectionPragmas() throws SQLException {
        for (int i = 0; i < 3; i++) {
            try (Connection conn = dataSource.getConnection();
                 java.sql.Statement stmt = conn.createStatement()) {

                try (ResultSet rs = stmt.executeQuery("PRAGMA foreign_keys;")) {
                    assertTrue(rs.next());
                    int fk = rs.getInt(1);
                    System.out.println("[AUDIT PRAGMA] Connection " + i + " foreign_keys: " + fk);
                    assertEquals(1, fk, "foreign_keys should be 1 (ON)");
                }

                try (ResultSet rs = stmt.executeQuery("PRAGMA busy_timeout;")) {
                    assertTrue(rs.next());
                    int bt = rs.getInt(1);
                    System.out.println("[AUDIT PRAGMA] Connection " + i + " busy_timeout: " + bt);
                    assertEquals(5000, bt, "busy_timeout should be 5000ms");
                }

                try (ResultSet rs = stmt.executeQuery("PRAGMA journal_mode;")) {
                    assertTrue(rs.next());
                    String jm = rs.getString(1);
                    System.out.println("[AUDIT PRAGMA] Connection " + i + " journal_mode: " + jm);
                    assertEquals("wal", jm.toLowerCase(), "journal_mode should be wal");
                }

                try (ResultSet rs = stmt.executeQuery("PRAGMA synchronous;")) {
                    assertTrue(rs.next());
                    int sync = rs.getInt(1);
                    System.out.println("[AUDIT PRAGMA] Connection " + i + " synchronous: " + sync);
                    assertEquals(1, sync, "synchronous should be 1 (NORMAL)");
                }
            }
        }
    }

    @Test
    @DisplayName("Invalid token increments failed_attempts counter")
    void testInvalidTokenIncrementsCounter() throws SQLException {
        BootstrapAdminRequest request = new BootstrapAdminRequest("admin", "admin@causalotel.io", "StrongP@ss123");

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () ->
                bootstrapService.bootstrapAdmin("wrong-token", request)
        );
        assertEquals(HttpStatus.UNAUTHORIZED, ex.getStatusCode());

        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT failed_attempts FROM bootstrap_tokens WHERE id = 1")) {
            ResultSet rs = ps.executeQuery();
            assertTrue(rs.next());
            assertEquals(1, rs.getInt(1));
        }
    }

    @Test
    @DisplayName("Two concurrent valid attempts produce exactly one successful admin creation")
    void testConcurrentValidAttempts() throws InterruptedException, SQLException {
        int threads = 2;
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(threads);

        AtomicInteger successes = new AtomicInteger(0);
        AtomicInteger conflicts = new AtomicInteger(0);

        for (int i = 0; i < threads; i++) {
            final int index = i;
            executor.submit(() -> {
                try {
                    startLatch.await();
                    BootstrapAdminRequest request = new BootstrapAdminRequest("admin" + index, "admin" + index + "@causalotel.io", "StrongP@ss123");
                    bootstrapService.bootstrapAdmin(validToken, request);
                    successes.incrementAndGet();
                } catch (ResponseStatusException e) {
                    if (e.getStatusCode() == HttpStatus.CONFLICT) {
                        conflicts.incrementAndGet();
                    }
                } catch (Exception ignored) {
                } finally {
                    doneLatch.countDown();
                }
            });
        }

        startLatch.countDown();
        doneLatch.await();
        executor.shutdown();

        assertEquals(1, successes.get(), "Exactly one request must succeed");
        assertEquals(1, conflicts.get(), "The other request must fail with 409 Conflict");

        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT COUNT(*) FROM users WHERE role = 'ROLE_ADMIN'")) {
            ResultSet rs = ps.executeQuery();
            assertTrue(rs.next());
            assertEquals(1, rs.getInt(1), "Only one admin user must be created");
        }
    }

    @Test
    @DisplayName("Expired token is rejected with 410 Gone")
    void testExpiredToken() throws SQLException {
        try (Connection conn = dataSource.getConnection()) {
            conn.createStatement().execute("UPDATE bootstrap_tokens SET expires_at = " + (Instant.now().toEpochMilli() - 1000) + " WHERE id = 1");
        }

        BootstrapAdminRequest request = new BootstrapAdminRequest("admin", "admin@causalotel.io", "StrongP@ss123");
        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () ->
                bootstrapService.bootstrapAdmin(validToken, request)
        );
        assertEquals(HttpStatus.GONE, ex.getStatusCode());
    }

    @Test
    @DisplayName("Locked token is rejected with 429 Too Many Requests")
    void testLockedToken() throws SQLException {
        try (Connection conn = dataSource.getConnection()) {
            conn.createStatement().execute("UPDATE bootstrap_tokens SET locked_until = " + (Instant.now().toEpochMilli() + 60000) + " WHERE id = 1");
        }

        BootstrapAdminRequest request = new BootstrapAdminRequest("admin", "admin@causalotel.io", "StrongP@ss123");
        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () ->
                bootstrapService.bootstrapAdmin(validToken, request)
        );
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, ex.getStatusCode());
    }

    @Test
    @DisplayName("Already consumed token cannot be reused")
    void testConsumedTokenCannotBeReused() {
        BootstrapAdminRequest request1 = new BootstrapAdminRequest("admin1", "admin1@causalotel.io", "StrongP@ss123");
        bootstrapService.bootstrapAdmin(validToken, request1);

        BootstrapAdminRequest request2 = new BootstrapAdminRequest("admin2", "admin2@causalotel.io", "StrongP@ss123");
        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () ->
                bootstrapService.bootstrapAdmin(validToken, request2)
        );
        assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());
    }

    @Test
    @DisplayName("GET /api/users returns user list")
    void testGetUsers() throws SQLException {
        ResponseEntity<java.util.List<Map<String, Object>>> response = userController.getUsers();
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
    }

    @Test
    @DisplayName("GET /api/users/{id} for missing user throws 404 NOT_FOUND")
    void testGetMissingUserThrows404() {
        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () ->
                userController.getUserById(99999)
        );
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatusCode());
    }
}
