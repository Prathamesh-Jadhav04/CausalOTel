package com.causalotel.order;

import com.causalotel.order.controller.HealthController;
import com.causalotel.order.controller.OrderController;
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
class OrderServiceTest {

    @Autowired
    private HealthController healthController;

    @Autowired
    private OrderController orderController;

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("Order service context loads successfully")
    void contextLoads() {
        assertNotNull(healthController);
        assertNotNull(orderController);
        assertNotNull(dataSource);
    }

    @Test
    @DisplayName("Health live endpoint returns status UP")
    void testHealthLive() {
        ResponseEntity<Map<String, Object>> response = healthController.live();
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("UP", response.getBody().get("status"));
        assertEquals("order-service", response.getBody().get("service"));
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
    @DisplayName("GET /api/orders returns orders list")
    void testGetOrders() throws SQLException {
        ResponseEntity<List<Map<String, Object>>> response = orderController.getOrders();
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
    }

    @Test
    @DisplayName("GET /api/orders/{orderId} for missing order throws 404 NOT_FOUND")
    void testGetMissingOrderThrows404() {
        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () ->
                orderController.getOrderByOrderId("NON_EXISTENT_ORDER_999")
        );
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatusCode());
    }
}
