package com.causalotel.user.service;

import com.causalotel.user.dto.BootstrapAdminRequest;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

@Service
public class AdminBootstrapService {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrapService.class);
    private static final long EXPIRATION_DURATION_MS = 15 * 60 * 1000L; // 15 minutes

    private final DataSource dataSource;
    private final PasswordEncoder passwordEncoder;

    public AdminBootstrapService(DataSource dataSource, PasswordEncoder passwordEncoder) {
        this.dataSource = dataSource;
        this.passwordEncoder = passwordEncoder;
    }

    @PostConstruct
    public void initializeBootstrapTokenIfNoAdmin() {
        try (Connection conn = dataSource.getConnection()) {
            // Check if admin already exists
            try (PreparedStatement ps = conn.prepareStatement("SELECT COUNT(*) FROM users WHERE role = 'ROLE_ADMIN'")) {
                ResultSet rs = ps.executeQuery();
                if (rs.next() && rs.getInt(1) > 0) {
                    return; // Admin exists; no bootstrap required
                }
            }

            // Check if active bootstrap token already exists
            try (PreparedStatement ps = conn.prepareStatement("SELECT COUNT(*) FROM bootstrap_tokens WHERE id = 1")) {
                ResultSet rs = ps.executeQuery();
                if (rs.next() && rs.getInt(1) > 0) {
                    return; // Token already provisioned
                }
            }

            // Generate cryptographically secure 256-bit token
            byte[] randomBytes = new byte[32];
            new SecureRandom().nextBytes(randomBytes);
            String rawToken = HexFormat.of().formatHex(randomBytes);
            String tokenHash = sha256(rawToken);

            long now = Instant.now().toEpochMilli();
            long expiresAt = now + EXPIRATION_DURATION_MS;

            // Persist token hash into database
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO bootstrap_tokens (id, token_hash, expires_at, created_at, failed_attempts) VALUES (1, ?, ?, ?, 0)")) {
                ps.setString(1, tokenHash);
                ps.setLong(2, expiresAt);
                ps.setLong(3, now);
                ps.executeUpdate();
            }

            // Secure delivery: write token to local AppData directory outside repository
            writeTokenToSecureFile(rawToken);

        } catch (SQLException e) {
            log.error("Failed to initialize admin bootstrap token in database: {}", e.getMessage());
        }
    }

    public void bootstrapAdmin(String rawToken, BootstrapAdminRequest request) {
        if (rawToken == null || rawToken.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Missing bootstrap token header.");
        }

        long now = Instant.now().toEpochMilli();
        String inputHash = sha256(rawToken.trim());

        // 1. Read-only verification check (Zero write locks held)
        TokenStatus status = queryTokenStatus();

        if (status.consumedAt() != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Bootstrap token has already been consumed.");
        }

        if (status.lockedUntil() != null && status.lockedUntil() > now) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Bootstrap endpoint is temporarily locked due to repeated failures.");
        }

        if (status.expiresAt() <= now) {
            throw new ResponseStatusException(HttpStatus.GONE, "Bootstrap token has expired.");
        }

        // Check if token matches
        if (!inputHash.equals(status.tokenHash())) {
            // Atomic increment of failed attempts in an autonomous write connection
            recordFailedAttempt(now);
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid bootstrap token.");
        }

        // 2. Hash password OUTSIDE the database write lock window to minimize lock contention
        String hashedPassword = passwordEncoder.encode(request.password());
        String userId = UUID.randomUUID().toString();

        // 3. Single atomic write transaction (No manual BEGIN statement; setAutoCommit(false) manages the transaction)
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                // Conditional atomic token consumption
                int updatedTokens;
                try (PreparedStatement ps = conn.prepareStatement(
                        "UPDATE bootstrap_tokens SET consumed_at = ? WHERE id = 1 AND consumed_at IS NULL AND expires_at > ? AND (locked_until IS NULL OR locked_until <= ?)")) {
                    ps.setLong(1, now);
                    ps.setLong(2, now);
                    ps.setLong(3, now);
                    updatedTokens = ps.executeUpdate();
                }

                if (updatedTokens == 0) {
                    conn.rollback();
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "Bootstrap token already consumed or locked by concurrent request.");
                }

                // Insert admin user
                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'ROLE_ADMIN', ?)")) {
                    ps.setString(1, userId);
                    ps.setString(2, request.username().trim());
                    ps.setString(3, request.email().trim().toLowerCase());
                    ps.setString(4, hashedPassword);
                    ps.setLong(5, now);
                    ps.executeUpdate();
                }

                conn.commit();
            } catch (SQLException e) {
                conn.rollback();
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Database transaction failed during admin creation.");
            }
        } catch (SQLException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to acquire database connection.");
        }

        // Best effort file cleanup
        cleanupSecureTokenFile();
    }

    private TokenStatus queryTokenStatus() {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT token_hash, expires_at, consumed_at, failed_attempts, locked_until FROM bootstrap_tokens WHERE id = 1")) {
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                String tokenHash = rs.getString("token_hash");
                long expiresAt = rs.getLong("expires_at");
                Long consumedAt = rs.getObject("consumed_at") != null ? rs.getLong("consumed_at") : null;
                int failedAttempts = rs.getInt("failed_attempts");
                Long lockedUntil = rs.getObject("locked_until") != null ? rs.getLong("locked_until") : null;
                return new TokenStatus(tokenHash, expiresAt, consumedAt, failedAttempts, lockedUntil);
            }
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No bootstrap token found in database.");
        } catch (SQLException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to query bootstrap token.");
        }
    }

    private void recordFailedAttempt(long now) {
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(true); // Auto-commit mode for standalone failure record
            // Atomic SQL increment preventing lost updates under concurrency
            try (PreparedStatement ps = conn.prepareStatement(
                    "UPDATE bootstrap_tokens SET failed_attempts = failed_attempts + 1, " +
                    "locked_until = CASE WHEN failed_attempts + 1 >= 3 THEN ? + ((failed_attempts + 1 - 2) * 60000) ELSE locked_until END " +
                    "WHERE id = 1")) {
                ps.setLong(1, now);
                ps.executeUpdate();
            }
        } catch (SQLException e) {
            log.error("Failed to record failed bootstrap attempt: {}", e.getMessage());
        }
    }

    private void writeTokenToSecureFile(String rawToken) {
        String localAppData = System.getenv("LOCALAPPDATA");
        if (localAppData == null || localAppData.isBlank()) {
            localAppData = System.getProperty("user.home") + File.separator + "AppData" + File.separator + "Local";
        }
        File secDir = new File(localAppData + File.separator + "CausalOTel" + File.separator + "security");
        if (!secDir.exists()) {
            secDir.mkdirs();
        }
        File tokenFile = new File(secDir, ".bootstrap_admin_token");
        try (FileWriter writer = new FileWriter(tokenFile, false)) {
            writer.write(rawToken);
            log.info("A one-time bootstrap token has been written to: {}. Use header 'X-Bootstrap-Token' to provision initial admin.", tokenFile.getAbsolutePath());
        } catch (IOException e) {
            log.error("Failed to write bootstrap token file: {}", e.getMessage());
        }
    }

    private void cleanupSecureTokenFile() {
        String localAppData = System.getenv("LOCALAPPDATA");
        if (localAppData == null || localAppData.isBlank()) {
            localAppData = System.getProperty("user.home") + File.separator + "AppData" + File.separator + "Local";
        }
        File tokenFile = new File(localAppData + File.separator + "CausalOTel" + File.separator + "security", ".bootstrap_admin_token");
        if (tokenFile.exists()) {
            tokenFile.delete();
        }
    }

    public static String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 algorithm not available", e);
        }
    }

    private record TokenStatus(String tokenHash, long expiresAt, Long consumedAt, int failedAttempts, Long lockedUntil) {}
}
