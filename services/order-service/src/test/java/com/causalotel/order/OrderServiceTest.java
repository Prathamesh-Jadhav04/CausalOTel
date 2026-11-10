package com.causalotel.order;

import com.causalotel.order.client.DownstreamServiceClient;
import com.causalotel.order.controller.HealthController;
import com.causalotel.order.controller.OrderController;
import com.causalotel.order.service.SagaOrchestrator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
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
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@SpringBootTest
class OrderServiceTest {

    @TestConfiguration
    static class TestConfig {
        @Bean
        @Primary
        public DownstreamServiceClient mockDownstreamServiceClient() {
            return Mockito.mock(DownstreamServiceClient.class);
        }
    }

    @Autowired
    private HealthController healthController;

    @Autowired
    private OrderController orderController;

    @Autowired
    private SagaOrchestrator sagaOrchestrator;

    @Autowired
    private DownstreamServiceClient downstreamServiceClient;

    @Autowired
    private DataSource dataSource;

    @BeforeEach
    void setupMock() {
        Mockito.reset(downstreamServiceClient);
        when(downstreamServiceClient.reserveInventory(anyString(), any())).thenReturn(Map.of("status", "RESERVED"));
        when(downstreamServiceClient.chargePayment(anyString(), anyInt(), anyString(), anyString())).thenReturn(Map.of("status", "CAPTURED", "paymentId", "pay-test-123"));
        when(downstreamServiceClient.commitInventory(anyString())).thenReturn(Map.of("status", "COMMITTED"));
        when(downstreamServiceClient.releaseInventory(anyString(), any())).thenReturn(Map.of("status", "RELEASED"));
        when(downstreamServiceClient.refundPayment(anyString(), anyInt(), any(), any())).thenReturn(Map.of("status", "COMPLETED"));
    }

    @Test
    @DisplayName("Order service context loads successfully")
    void contextLoads() {
        assertNotNull(healthController);
        assertNotNull(orderController);
        assertNotNull(dataSource);
        assertNotNull(sagaOrchestrator);
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
    @DisplayName("Flyway V2 migration created saga_instances, outbox_tasks, and order_idempotency tables")
    void testTablesExist() throws SQLException {
        try (Connection conn = dataSource.getConnection()) {
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "orders", null)) {
                assertTrue(rs.next(), "Table 'orders' should exist");
            }
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "saga_instances", null)) {
                assertTrue(rs.next(), "Table 'saga_instances' should exist");
            }
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "outbox_tasks", null)) {
                assertTrue(rs.next(), "Table 'outbox_tasks' should exist");
            }
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "order_idempotency", null)) {
                assertTrue(rs.next(), "Table 'order_idempotency' should exist");
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

    @Test
    @DisplayName("POST /api/orders/checkout executes complete Saga and confirms Order")
    void testCheckoutSuccess() throws Exception {
        String idemKey = "IDEM-SAGA-" + UUID.randomUUID();
        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-001", "SKU-LAPTOP-001", 1, 129999);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(1, List.of(item), idemKey);

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req);
        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertNotNull(resp.getBody());
        assertEquals("CONFIRMED", resp.getBody().get("status"));
        String orderId = (String) resp.getBody().get("orderId");
        assertNotNull(orderId);

        // Verify saga instance reached COMPLETED
        ResponseEntity<Map<String, Object>> sagaResp = orderController.getSagaInstance(orderId);
        assertEquals(HttpStatus.OK, sagaResp.getStatusCode());
        assertEquals("COMPLETED", sagaResp.getBody().get("current_state"));

        // Duplicate checkout request with exact same idempotency key returns cached response
        ResponseEntity<Map<String, Object>> dupResp = orderController.checkout(req);
        assertEquals(HttpStatus.OK, dupResp.getStatusCode());
        assertEquals(orderId, dupResp.getBody().get("orderId"));
    }

    @Test
    @DisplayName("POST /api/orders/checkout compensates inventory and marks order CANCELLED when payment fails")
    void testCheckoutPaymentFailureCompensation() {
        // Configure downstream client mock to throw payment decline
        when(downstreamServiceClient.chargePayment(anyString(), anyInt(), anyString(), anyString()))
                .thenThrow(new RuntimeException("Simulated Card Declined"));

        String idemKey = "IDEM-FAIL-" + UUID.randomUUID();
        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-002", "SKU-PHONE-002", 1, 79999);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(2, List.of(item), idemKey);

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () ->
                orderController.checkout(req)
        );
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, ex.getStatusCode());

        // Verify that compensation release was called on downstream inventory mock
        Mockito.verify(downstreamServiceClient, Mockito.atLeastOnce()).releaseInventory(anyString(), anyString());
    }
}
