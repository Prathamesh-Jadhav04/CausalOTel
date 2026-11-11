package com.causalotel.order;

import com.causalotel.order.client.DownstreamServiceClient;
import com.causalotel.order.controller.HealthController;
import com.causalotel.order.controller.OrderController;
import com.causalotel.order.service.OutboxWorker;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

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
    private OutboxWorker outboxWorker;

    @Autowired
    private DataSource dataSource;

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        TestDatabaseSupport.register(registry, "order.db");
    }

    @BeforeEach
    void setupMock() {
        // Hard guard: saga recovery tests must never touch the live order database.
        TestDatabaseSupport.assertIsolated(dataSource);
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

    @Test
    @DisplayName("Scenario 1: Payment succeeds, but Order Service receives HTTP 504 -> Reconciles and confirms order")
    void testScenario1_PaymentSucceeds_OrderServiceReceives504() throws Exception {
        String idemKey = "IDEM-SCENARIO-1-" + UUID.randomUUID();
        String expectedPaymentId = "pay-scen1-" + UUID.randomUUID().toString().substring(0, 8);

        when(downstreamServiceClient.chargePayment(anyString(), anyInt(), anyString(), anyString()))
                .thenThrow(new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT, "Gateway Timeout"));
        when(downstreamServiceClient.getPaymentByOrderId(anyString()))
                .thenReturn(Optional.of(Map.of("status", "CAPTURED", "paymentId", expectedPaymentId)));

        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-001", "SKU-001", 1, 5000);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(101, List.of(item), idemKey);

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req);
        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertNotNull(resp.getBody());
        assertEquals("CONFIRMED", resp.getBody().get("status"));
        assertEquals(expectedPaymentId, resp.getBody().get("paymentId"));

        verify(downstreamServiceClient, atLeastOnce()).commitInventory(anyString());
        verify(downstreamServiceClient, never()).releaseInventory(anyString(), anyString());
    }

    @Test
    @DisplayName("Scenario 2: Payment succeeds, but the response is lost -> Reconciles and confirms order")
    void testScenario2_PaymentSucceeds_ResponseLost() throws Exception {
        String idemKey = "IDEM-SCENARIO-2-" + UUID.randomUUID();
        String expectedPaymentId = "pay-scen2-" + UUID.randomUUID().toString().substring(0, 8);

        when(downstreamServiceClient.chargePayment(anyString(), anyInt(), anyString(), anyString()))
                .thenThrow(new ResourceAccessException("I/O error on POST request: Connection reset by peer"));
        when(downstreamServiceClient.getPaymentByOrderId(anyString()))
                .thenReturn(Optional.of(Map.of("status", "CAPTURED", "paymentId", expectedPaymentId)));

        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-002", "SKU-002", 1, 8000);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(102, List.of(item), idemKey);

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req);
        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertEquals("CONFIRMED", resp.getBody().get("status"));
        assertEquals(expectedPaymentId, resp.getBody().get("paymentId"));

        verify(downstreamServiceClient, never()).releaseInventory(anyString(), anyString());
        verify(downstreamServiceClient, atLeastOnce()).commitInventory(anyString());
    }

    @Test
    @DisplayName("Scenario 3: Payment is genuinely declined -> Safely releases inventory and cancels order")
    void testScenario3_PaymentGenuinelyDeclined() {
        String idemKey = "IDEM-SCENARIO-3-" + UUID.randomUUID();

        when(downstreamServiceClient.chargePayment(anyString(), anyInt(), anyString(), anyString()))
                .thenThrow(new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Card Declined: Insufficient Funds"));

        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-003", "SKU-003", 1, 15000);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(103, List.of(item), idemKey);

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> orderController.checkout(req));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, ex.getStatusCode());

        verify(downstreamServiceClient, atLeastOnce()).releaseInventory(anyString(), contains("Payment declined"));
    }

    @Test
    @DisplayName("Scenario 4: Payment gateway returns 503 -> Enters reconciliation, never releases inventory blindly")
    void testScenario4_PaymentGatewayReturns503_EntersReconciliation() throws SQLException {
        String idemKey = "IDEM-SCENARIO-4-" + UUID.randomUUID();

        when(downstreamServiceClient.chargePayment(anyString(), anyInt(), anyString(), anyString()))
                .thenThrow(new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Gateway Unavailable"));
        when(downstreamServiceClient.getPaymentByOrderId(anyString()))
                .thenReturn(Optional.empty());

        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-004", "SKU-004", 1, 20000);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(104, List.of(item), idemKey);

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> orderController.checkout(req));
        assertEquals(HttpStatus.GATEWAY_TIMEOUT, ex.getStatusCode());

        verify(downstreamServiceClient, never()).releaseInventory(anyString(), anyString());

        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT o.status as order_status, s.current_state as saga_state FROM orders o JOIN saga_instances s ON o.order_id = s.order_id WHERE o.user_id = 104")) {
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next(), "Order must exist in DB");
                assertEquals("PENDING_RECONCILIATION", rs.getString("order_status"));
                assertEquals("RECONCILIATION_REQUIRED", rs.getString("saga_state"));
            }
        }
    }

    @Test
    @DisplayName("Scenario 5: Duplicate checkout requests arrive simultaneously -> Exactly 1 order and payment captured")
    void testScenario5_DuplicateSimultaneousCheckouts() throws Exception {
        String idemKey = "IDEM-SCENARIO-5-" + UUID.randomUUID();
        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-005", "SKU-005", 1, 9999);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(105, List.of(item), idemKey);

        int numThreads = 2;
        ExecutorService executor = Executors.newFixedThreadPool(numThreads);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(numThreads);
        List<Future<ResponseEntity<Map<String, Object>>>> futures = new ArrayList<>();

        for (int i = 0; i < numThreads; i++) {
            futures.add(executor.submit(() -> {
                try {
                    startLatch.await();
                    return orderController.checkout(req);
                } finally {
                    doneLatch.countDown();
                }
            }));
        }

        startLatch.countDown();
        assertTrue(doneLatch.await(10, TimeUnit.SECONDS), "Concurrent checkout requests must complete");
        executor.shutdown();

        ResponseEntity<Map<String, Object>> resp1 = futures.get(0).get();
        ResponseEntity<Map<String, Object>> resp2 = futures.get(1).get();

        assertEquals(HttpStatus.OK, resp1.getStatusCode());
        assertEquals(HttpStatus.OK, resp2.getStatusCode());

        String orderId1 = (String) resp1.getBody().get("orderId");
        String orderId2 = (String) resp2.getBody().get("orderId");
        assertEquals(orderId1, orderId2, "Both simultaneous requests must resolve to the identical orderId");

        verify(downstreamServiceClient, times(1)).chargePayment(eq(orderId1), eq(9999), anyString(), anyString());
    }

    @Test
    @DisplayName("Scenario 7: Inventory commit succeeds, but response is lost -> Retry succeeds, never refunds")
    void testScenario7_InventoryCommitSucceeds_ResponseLostRetry() throws Exception {
        String idemKey = "IDEM-SCENARIO-7-" + UUID.randomUUID();

        when(downstreamServiceClient.commitInventory(anyString()))
                .thenThrow(new ResourceAccessException("Read timed out"))
                .thenReturn(Map.of("status", "COMMITTED"));

        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-007", "SKU-007", 1, 12000);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(107, List.of(item), idemKey);

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req);
        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertEquals("CONFIRMED", resp.getBody().get("status"));

        verify(downstreamServiceClient, atLeast(2)).commitInventory(anyString());
        verify(downstreamServiceClient, never()).refundPayment(anyString(), anyInt(), anyString(), anyString());
    }

    @Test
    @DisplayName("Scenario 9: Application crashes after payment capture -> OutboxWorker recovers and confirms order")
    void testScenario9_ApplicationCrashRecoveryAfterPaymentCapture() throws SQLException {
        String crashedOrderId = "ord-crash-" + UUID.randomUUID().toString().substring(0, 8);
        String crashedSagaId = "saga-crash-" + UUID.randomUUID().toString().substring(0, 8);
        long oldTime = System.currentTimeMillis() - 10000;

        try (Connection conn = dataSource.getConnection()) {
            try (PreparedStatement del1 = conn.prepareStatement("DELETE FROM saga_instances WHERE order_id = ?");
                 PreparedStatement del2 = conn.prepareStatement("DELETE FROM orders WHERE order_id = ?")) {
                del1.setString(1, crashedOrderId);
                del1.executeUpdate();
                del2.setString(1, crashedOrderId);
                del2.executeUpdate();
            }
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO orders (order_id, user_id, status, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")) {
                ps.setString(1, crashedOrderId);
                ps.setInt(2, 999);
                ps.setString(3, "PENDING");
                ps.setInt(4, 3500);
                ps.setLong(5, oldTime);
                ps.setLong(6, oldTime);
                ps.executeUpdate();
            }

            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO saga_instances (id, order_id, current_state, error_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")) {
                ps.setString(1, crashedSagaId);
                ps.setString(2, crashedOrderId);
                ps.setString(3, "PAYMENT_CONFIRMED");
                ps.setString(4, null);
                ps.setLong(5, oldTime);
                ps.setLong(6, oldTime);
                ps.executeUpdate();
            }
        }

        outboxWorker.recoverStaleSagas();

        verify(downstreamServiceClient, atLeastOnce()).commitInventory(eq(crashedOrderId));

        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT o.status as order_status, s.current_state as saga_state FROM orders o JOIN saga_instances s ON o.order_id = s.order_id WHERE o.order_id = ?")) {
            ps.setString(1, crashedOrderId);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                assertEquals("CONFIRMED", rs.getString("order_status"));
                assertEquals("COMPLETED", rs.getString("saga_state"));
            }
        }
    }
}
