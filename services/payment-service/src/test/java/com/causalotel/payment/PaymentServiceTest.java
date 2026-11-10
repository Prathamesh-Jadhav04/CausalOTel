package com.causalotel.payment;

import com.causalotel.payment.controller.HealthController;
import com.causalotel.payment.controller.PaymentController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class PaymentServiceTest {

    @Autowired
    private HealthController healthController;

    @Autowired
    private PaymentController paymentController;

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("Payment service context loads successfully")
    void contextLoads() {
        assertNotNull(healthController);
        assertNotNull(paymentController);
        assertNotNull(dataSource);
    }

    @Test
    @DisplayName("Health live endpoint returns status UP")
    void testHealthLive() {
        ResponseEntity<Map<String, Object>> response = healthController.live();
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("UP", response.getBody().get("status"));
        assertEquals("payment-service", response.getBody().get("service"));
    }

    @Test
    @DisplayName("Health ready endpoint returns status UP and database connectivity")
    void testHealthReady() {
        ResponseEntity<Map<String, Object>> response = healthController.ready();
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("UP", response.getBody().get("status"));
        assertEquals("UP", response.getBody().get("database"));
    }

    @Test
    @DisplayName("Verify effective PRAGMAs on pooled SQLite connections")
    void testPooledConnectionPragmas() throws SQLException {
        for (int i = 0; i < 3; i++) {
            try (Connection conn = dataSource.getConnection();
                 Statement stmt = conn.createStatement()) {

                try (ResultSet rs = stmt.executeQuery("PRAGMA foreign_keys;")) {
                    assertTrue(rs.next());
                    assertEquals(1, rs.getInt(1), "foreign_keys must be 1 (ON)");
                }

                try (ResultSet rs = stmt.executeQuery("PRAGMA busy_timeout;")) {
                    assertTrue(rs.next());
                    assertEquals(5000, rs.getInt(1), "busy_timeout must be 5000ms");
                }

                try (ResultSet rs = stmt.executeQuery("PRAGMA journal_mode;")) {
                    assertTrue(rs.next());
                    assertEquals("wal", rs.getString(1).toLowerCase(), "journal_mode must be wal");
                }

                try (ResultSet rs = stmt.executeQuery("PRAGMA synchronous;")) {
                    assertTrue(rs.next());
                    assertEquals(1, rs.getInt(1), "synchronous must be 1 (NORMAL)");
                }
            }
        }
    }

    @Test
    @DisplayName("Flyway schema migration created payments, refunds, and payment_idempotency tables")
    void testTablesExist() throws SQLException {
        try (Connection conn = dataSource.getConnection()) {
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "payments", null)) {
                assertTrue(rs.next(), "Table 'payments' should exist");
            }
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "refunds", null)) {
                assertTrue(rs.next(), "Table 'refunds' should exist");
            }
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "payment_idempotency", null)) {
                assertTrue(rs.next(), "Table 'payment_idempotency' should exist");
            }
        }
    }

    @Test
    @DisplayName("GET /api/payments returns payments list")
    void testGetPayments() throws SQLException {
        ResponseEntity<List<Map<String, Object>>> response = paymentController.getPayments();
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
    }

    @Test
    @DisplayName("GET /api/payments/{paymentId} for missing payment throws 404 NOT_FOUND")
    void testGetMissingPaymentThrows404() {
        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () ->
                paymentController.getPaymentByPaymentId("NON_EXISTENT_PAYMENT_999")
        );
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatusCode());
    }
}
