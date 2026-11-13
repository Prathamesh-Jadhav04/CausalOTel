package com.causalotel.order;

import com.causalotel.order.client.DownstreamServiceClient;
import com.causalotel.order.controller.HealthController;
import com.causalotel.order.controller.OrderController;
import com.causalotel.order.security.AuthPrincipal;
import com.causalotel.order.service.OutboxWorker;
import com.causalotel.order.service.SagaOrchestrator;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
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

    @Autowired
    private MeterRegistry meterRegistry;

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        TestDatabaseSupport.register(registry, "order.db");
    }

    @BeforeEach
    void setupMock() {
        // Hard guard: saga recovery tests must never touch the live order database.
        TestDatabaseSupport.assertIsolated(dataSource);
        Mockito.reset(downstreamServiceClient);

        // C-02: the order service resolves every unit price from the catalog.
        Map<String, Integer> catalog = Map.of(
                "SKU-LAPTOP-001", 129999,
                "SKU-PHONE-002", 79999,
                "SKU-001", 5000,
                "SKU-002", 8000,
                "SKU-003", 15000,
                "SKU-004", 20000,
                "SKU-005", 9999,
                "SKU-007", 12000,
                "SKU-OUT-OF-STOCK", 14999
        );
        when(downstreamServiceClient.getProductBySku(anyString())).thenAnswer(invocation -> {
            String sku = invocation.getArgument(0);
            Integer price = catalog.get(sku);
            if (price == null) {
                return Optional.empty();
            }
            int stock = "SKU-OUT-OF-STOCK".equals(sku) ? 0 : 100;
            return Optional.of(Map.of(
                    "id", "PROD-" + sku.substring(4),
                    "sku", sku,
                    "price_cents", price,
                    "stock_quantity", stock
            ));
        });

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
        ResponseEntity<List<Map<String, Object>>> response = orderController.getOrders(adminAuth());
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
    }

    @Test
    @DisplayName("GET /api/orders/{orderId} for missing order throws 404 NOT_FOUND")
    void testGetMissingOrderThrows404() {
        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () ->
                orderController.getOrderByOrderId("NON_EXISTENT_ORDER_999", adminAuth())
        );
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatusCode());
    }

    @Test
    @DisplayName("POST /api/orders/checkout executes complete Saga and confirms Order")
    void testCheckoutSuccess() throws Exception {
        String idemKey = "IDEM-SAGA-" + UUID.randomUUID();
        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-LAPTOP-001", "SKU-LAPTOP-001", 1, 129999);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest("user-1", List.of(item), idemKey);

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req, authFor(req.userId()));
        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertNotNull(resp.getBody());
        assertEquals("CONFIRMED", resp.getBody().get("status"));
        String orderId = (String) resp.getBody().get("orderId");
        assertNotNull(orderId);

        // Verify saga instance reached COMPLETED
        ResponseEntity<Map<String, Object>> sagaResp = orderController.getSagaInstance(orderId, adminAuth());
        assertEquals(HttpStatus.OK, sagaResp.getStatusCode());
        assertEquals("COMPLETED", sagaResp.getBody().get("current_state"));

        // Duplicate checkout request with exact same idempotency key returns cached response
        ResponseEntity<Map<String, Object>> dupResp = orderController.checkout(req, authFor(req.userId()));
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
        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-PHONE-002", "SKU-PHONE-002", 1, 79999);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest("user-2", List.of(item), idemKey);

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () ->
                orderController.checkout(req, authFor(req.userId()))
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
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest("user-101", List.of(item), idemKey);

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req, authFor(req.userId()));
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
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest("user-102", List.of(item), idemKey);

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req, authFor(req.userId()));
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
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest("user-103", List.of(item), idemKey);

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> orderController.checkout(req, authFor(req.userId())));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, ex.getStatusCode());

        verify(downstreamServiceClient, atLeastOnce()).releaseInventory(anyString(), contains("Payment declined"));
    }

    @Test
    @DisplayName("Scenario 4: Payment gateway returns 503 -> Enters reconciliation, never releases inventory blindly")
    void testScenario4_PaymentGatewayReturns503_EntersReconciliation() throws Exception {
        String idemKey = "IDEM-SCENARIO-4-" + UUID.randomUUID();

        when(downstreamServiceClient.chargePayment(anyString(), anyInt(), anyString(), anyString()))
                .thenThrow(new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Gateway Unavailable"));
        when(downstreamServiceClient.getPaymentByOrderId(anyString()))
                .thenReturn(Optional.empty());

        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-004", "SKU-004", 1, 20000);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest("user-104", List.of(item), idemKey);

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> orderController.checkout(req, authFor(req.userId())));
        assertEquals(HttpStatus.GATEWAY_TIMEOUT, ex.getStatusCode());

        verify(downstreamServiceClient, never()).releaseInventory(anyString(), anyString());

        String orderId;
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT o.order_id, o.status as order_status, s.current_state as saga_state, s.lease_expires_at FROM orders o JOIN saga_instances s ON o.order_id = s.order_id WHERE o.user_id = 'user-104'")) {
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next(), "Order must exist in DB");
                orderId = rs.getString("order_id");
                assertEquals("PENDING_RECONCILIATION", rs.getString("order_status"));
                assertEquals("RECONCILIATION_REQUIRED", rs.getString("saga_state"));
                assertEquals(0L, rs.getLong("lease_expires_at"),
                        "the checkout must release its saga lease before returning the timeout");
            }
        }

        // M-11 regression: an operator reconcile immediately after the 504 must
        // be able to claim the saga instead of waiting 30 seconds for lease
        // expiry. This failed in the live demo before failCheckout released it.
        Mockito.doReturn(Map.of("status", "CAPTURED", "paymentId", "pay-reconciled"))
                .when(downstreamServiceClient)
                .chargePayment(anyString(), anyInt(), anyString(), anyString());
        Mockito.doReturn(Map.of("status", "COMMITTED"))
                .when(downstreamServiceClient)
                .commitInventory(anyString());
        ResponseEntity<Map<String, Object>> reconciled = orderController.reconcile(orderId);
        assertEquals("CONFIRMED", reconciled.getBody().get("status"));
    }

    @Test
    @DisplayName("Scenario 5: 50 simultaneous duplicate checkouts -> exactly one order and one payment")
    void testScenario5_DuplicateSimultaneousCheckouts() throws Exception {
        String idemKey = "IDEM-SCENARIO-5-" + UUID.randomUUID();
        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-005", "SKU-005", 1, 9999);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest("user-105", List.of(item), idemKey);

        int numThreads = 50;
        ExecutorService executor = Executors.newFixedThreadPool(numThreads);
        CountDownLatch startLatch = new CountDownLatch(1);
        List<Future<ResponseEntity<Map<String, Object>>>> futures = new ArrayList<>();

        for (int i = 0; i < numThreads; i++) {
            futures.add(executor.submit(() -> {
                startLatch.await();
                return orderController.checkout(req, authFor(req.userId()));
            }));
        }

        startLatch.countDown();
        executor.shutdown();
        assertTrue(executor.awaitTermination(60, TimeUnit.SECONDS),
                "Concurrent checkout requests must complete");

        String expectedOrderId = null;
        for (Future<ResponseEntity<Map<String, Object>>> future : futures) {
            ResponseEntity<Map<String, Object>> response = future.get();
            assertEquals(HttpStatus.OK, response.getStatusCode());
            String orderId = (String) response.getBody().get("orderId");
            if (expectedOrderId == null) {
                expectedOrderId = orderId;
            }
            assertEquals(expectedOrderId, orderId,
                    "Every duplicate request must resolve to the identical orderId");
        }

        verify(downstreamServiceClient, times(1))
                .chargePayment(eq(expectedOrderId), eq(9999), anyString(), anyString());

        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT COUNT(*) FROM orders WHERE user_id = ?")) {
            ps.setString(1, "user-105");
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                assertEquals(1, rs.getInt(1), "Exactly one order row may exist for the key");
            }
        }
    }

    @Test
    @DisplayName("C-02: tampered client price is rejected before any order or payment write")
    void testTamperedPriceRejected() throws SQLException {
        String idemKey = "IDEM-PRICE-TAMPER-" + UUID.randomUUID();
        SagaOrchestrator.OrderItemDto item =
                new SagaOrchestrator.OrderItemDto("PROD-LAPTOP-001", "SKU-LAPTOP-001", 1, 1);
        SagaOrchestrator.CheckoutRequest req =
                new SagaOrchestrator.CheckoutRequest("user-201", List.of(item), idemKey);

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> orderController.checkout(req, authFor(req.userId())));
        assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());

        verify(downstreamServiceClient, never())
                .chargePayment(anyString(), anyInt(), anyString(), anyString());
        assertEquals(0, countOrdersForUser("user-201"));
    }

    @Test
    @DisplayName("C-02: omitted client price is resolved from the catalog and charged server-side")
    void testCatalogPriceUsedWhenClientOmitsPrice() throws Exception {
        String idemKey = "IDEM-PRICE-CATALOG-" + UUID.randomUUID();
        SagaOrchestrator.OrderItemDto item =
                new SagaOrchestrator.OrderItemDto("PROD-LAPTOP-001", "SKU-LAPTOP-001", 2);
        SagaOrchestrator.CheckoutRequest req =
                new SagaOrchestrator.CheckoutRequest("user-202", List.of(item), idemKey);

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req, authFor(req.userId()));
        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertEquals(259998, resp.getBody().get("totalCents"));

        verify(downstreamServiceClient, times(1))
                .chargePayment(anyString(), eq(259998), eq("USD"), anyString());

        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT total_cents FROM orders WHERE order_id = ?")) {
            ps.setString(1, (String) resp.getBody().get("orderId"));
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                assertEquals(259998, rs.getInt("total_cents"));
            }
        }
    }

    @Test
    @DisplayName("C-02: out-of-stock catalog record is rejected before writes")
    void testOutOfStockCatalogRecordRejected() {
        SagaOrchestrator.OrderItemDto item =
                new SagaOrchestrator.OrderItemDto("PROD-OUT-OF-STOCK", "SKU-OUT-OF-STOCK", 1);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(
                "user-203", List.of(item), "IDEM-OOS-" + UUID.randomUUID());

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> orderController.checkout(req, authFor(req.userId())));
        assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());
        assertTrue(String.valueOf(ex.getReason()).contains("out of stock"));
    }

    @Test
    @DisplayName("M-06: more than 50 checkout items is rejected before any catalog call")
    void testCheckoutRejectsMoreThanMaxItems() {
        List<SagaOrchestrator.OrderItemDto> items = new ArrayList<>();
        for (int i = 0; i < 51; i++) {
            items.add(new SagaOrchestrator.OrderItemDto(null, "SKU-001", 1));
        }
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(
                "user-204", items, "IDEM-M06-ITEMS-" + UUID.randomUUID());

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> orderController.checkout(req, authFor(req.userId())));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
        verify(downstreamServiceClient, never()).getProductBySku(anyString());
    }

    @Test
    @DisplayName("M-06: exactly 50 duplicate items coalesce into one reservation")
    @SuppressWarnings("unchecked")
    void testFiftyDuplicateItemsCoalesceIntoOneReservation() throws Exception {
        List<SagaOrchestrator.OrderItemDto> items = new ArrayList<>();
        for (int i = 0; i < 50; i++) {
            items.add(new SagaOrchestrator.OrderItemDto(null, "SKU-001", 1));
        }
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(
                "user-205", items, "IDEM-M06-COALESCE-" + UUID.randomUUID());

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req, authFor(req.userId()));
        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertEquals(250000, resp.getBody().get("totalCents"));

        ArgumentCaptor<List<Map<String, Object>>> captor = ArgumentCaptor.forClass(List.class);
        verify(downstreamServiceClient).reserveInventory(anyString(), captor.capture());
        assertEquals(1, captor.getValue().size());
        assertEquals(50, ((Number) captor.getValue().get(0).get("quantity")).intValue());
    }

    @Test
    @DisplayName("M-06: quantity at the per-item limit is accepted")
    void testQuantityAtLimitAccepted() throws Exception {
        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto(null, "SKU-001", 1000);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(
                "user-206", List.of(item), "IDEM-M06-QTY-MAX-" + UUID.randomUUID());

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req, authFor(req.userId()));
        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertEquals(5_000_000, resp.getBody().get("totalCents"));
    }

    @Test
    @DisplayName("M-06: quantity above the per-item limit is rejected")
    void testQuantityAboveLimitRejected() {
        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto(null, "SKU-001", 1001);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(
                "user-207", List.of(item), "IDEM-M06-QTY-OVER-" + UUID.randomUUID());

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> orderController.checkout(req, authFor(req.userId())));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
        verify(downstreamServiceClient, never()).chargePayment(
                anyString(), anyInt(), anyString(), anyString());
    }

    @Test
    @DisplayName("M-06: duplicate SKUs whose combined quantity exceeds the limit are rejected")
    void testDuplicateSkuCombinedQuantityAboveLimitRejected() {
        List<SagaOrchestrator.OrderItemDto> items = List.of(
                new SagaOrchestrator.OrderItemDto(null, "SKU-001", 600),
                new SagaOrchestrator.OrderItemDto(null, "SKU-001", 500));
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(
                "user-208", items, "IDEM-M06-COMBINED-" + UUID.randomUUID());

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> orderController.checkout(req, authFor(req.userId())));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
    }

    @Test
    @DisplayName("M-06: an order total above the configured maximum is rejected")
    void testTotalAboveMaximumRejected() {
        SagaOrchestrator.OrderItemDto item =
                new SagaOrchestrator.OrderItemDto("PROD-LAPTOP-001", "SKU-LAPTOP-001", 1000);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(
                "user-209", List.of(item), "IDEM-M06-TOTAL-" + UUID.randomUUID());

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> orderController.checkout(req, authFor(req.userId())));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
        verify(downstreamServiceClient, never()).reserveInventory(anyString(), any());
    }

    @Test
    @DisplayName("M-06: an unknown SKU is rejected before any order write")
    void testUnknownSkuRejected() throws SQLException {
        SagaOrchestrator.OrderItemDto item =
                new SagaOrchestrator.OrderItemDto(null, "SKU-NOT-IN-CATALOG", 1);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(
                "user-210", List.of(item), "IDEM-M06-UNKNOWN-" + UUID.randomUUID());

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> orderController.checkout(req, authFor(req.userId())));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, ex.getStatusCode());
        assertTrue(String.valueOf(ex.getReason()).contains("Unknown"));
        assertEquals(0, countOrdersForUser("user-210"));
    }

    @Test
    @DisplayName("M-06: a client productId that contradicts the catalog record is rejected")
    void testProductIdMismatchRejected() throws SQLException {
        SagaOrchestrator.OrderItemDto item =
                new SagaOrchestrator.OrderItemDto("PROD-WRONG", "SKU-001", 1);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(
                "user-211", List.of(item), "IDEM-M06-PRODUCT-" + UUID.randomUUID());

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> orderController.checkout(req, authFor(req.userId())));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, ex.getStatusCode());
        assertTrue(String.valueOf(ex.getReason()).contains("productId"));
        assertEquals(0, countOrdersForUser("user-211"));
    }

    @Test
    @DisplayName("M-06: an omitted productId is filled from the catalog record")
    void testOmittedProductIdUsesCatalogRecord() throws Exception {
        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto(null, "SKU-001", 1);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest(
                "user-212", List.of(item), "IDEM-M06-CATALOG-ID-" + UUID.randomUUID());

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req, authFor(req.userId()));
        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertEquals("CONFIRMED", resp.getBody().get("status"));
    }

    @Test
    @DisplayName("H-03: same idempotency key with a different SKU returns 409 and creates no second order")
    void testIdempotencyKeyReusedWithDifferentSku() throws Exception {
        String idemKey = "IDEM-H03-" + UUID.randomUUID();
        SagaOrchestrator.OrderItemDto first =
                new SagaOrchestrator.OrderItemDto("PROD-001", "SKU-001", 1, 5000);
        SagaOrchestrator.OrderItemDto second =
                new SagaOrchestrator.OrderItemDto("PROD-002", "SKU-002", 1, 8000);

        ResponseEntity<Map<String, Object>> firstResp = orderController.checkout(
                new SagaOrchestrator.CheckoutRequest("user-204", List.of(first), idemKey),
                authFor("user-204"));
        assertEquals(HttpStatus.OK, firstResp.getStatusCode());

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> orderController.checkout(
                        new SagaOrchestrator.CheckoutRequest("user-204", List.of(second), idemKey),
                        authFor("user-204")));
        assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());

        verify(downstreamServiceClient, times(1))
                .chargePayment(anyString(), anyInt(), anyString(), anyString());
        assertEquals(1, countOrdersForUser("user-204"));
    }

    @Test
    @DisplayName("H-03: an idempotency key is bound to the user that created it")
    void testIdempotencyKeyBoundToUser() throws Exception {
        String idemKey = "IDEM-H03-USER-" + UUID.randomUUID();
        SagaOrchestrator.OrderItemDto item =
                new SagaOrchestrator.OrderItemDto("PROD-001", "SKU-001", 1, 5000);

        orderController.checkout(
                new SagaOrchestrator.CheckoutRequest("user-205", List.of(item), idemKey),
                authFor("user-205"));

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> orderController.checkout(
                        new SagaOrchestrator.CheckoutRequest("user-206", List.of(item), idemKey),
                        authFor("user-206")));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatusCode());
    }

    @Test
    @DisplayName("H-06: an outbox persistence failure aborts checkout instead of reporting success")
    void testOutboxPersistenceFailureAbortsCheckout() throws Exception {
        String idemKey = "IDEM-H06-" + UUID.randomUUID();
        SagaOrchestrator.OrderItemDto item =
                new SagaOrchestrator.OrderItemDto("PROD-003", "SKU-003", 1, 15000);

        when(downstreamServiceClient.chargePayment(anyString(), anyInt(), anyString(), anyString()))
                .thenThrow(new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Card Declined"));
        when(downstreamServiceClient.releaseInventory(anyString(), any()))
                .thenThrow(new ResourceAccessException("inventory unavailable"));

        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {
            stmt.execute("ALTER TABLE outbox_tasks RENAME TO outbox_tasks_hidden");
        }

        try {
            assertThrows(SagaOrchestrator.SagaPersistenceException.class,
                    () -> orderController.checkout(
                            new SagaOrchestrator.CheckoutRequest("user-207", List.of(item), idemKey),
                            authFor("user-207")));

            try (Connection conn = dataSource.getConnection();
                 PreparedStatement ps = conn.prepareStatement(
                         "SELECT status FROM orders WHERE user_id = ?")) {
                ps.setString(1, "user-207");
                try (ResultSet rs = ps.executeQuery()) {
                    assertTrue(rs.next(), "The order row created before the failure must still exist");
                    assertNotEquals("CONFIRMED", rs.getString("status"));
                }
            }
        } finally {
            try (Connection conn = dataSource.getConnection();
                 Statement stmt = conn.createStatement()) {
                stmt.execute("ALTER TABLE outbox_tasks_hidden RENAME TO outbox_tasks");
            }
        }
    }

    @Test
    @DisplayName("H-07: recovery ignores a saga whose lease is still active")
    void testRecoveryDoesNotTouchActiveLease() throws SQLException {
        String orderId = "ord-lease-active-" + UUID.randomUUID().toString().substring(0, 8);
        String sagaId = "saga-lease-active-" + UUID.randomUUID().toString().substring(0, 8);
        insertSagaFixture(orderId, sagaId, "PAYMENT_CONFIRMED",
                "active-checkout", System.currentTimeMillis() + 60_000);

        outboxWorker.recoverStaleSagas();

        verify(downstreamServiceClient, never()).commitInventory(eq(orderId));
        assertEquals("PAYMENT_CONFIRMED", readSagaState(sagaId));
    }

    @Test
    @DisplayName("H-07: recovery claims an expired saga exactly once and confirms the order")
    void testRecoveryClaimsExpiredSagaOnce() throws SQLException {
        String orderId = "ord-lease-expired-" + UUID.randomUUID().toString().substring(0, 8);
        String sagaId = "saga-lease-expired-" + UUID.randomUUID().toString().substring(0, 8);
        insertSagaFixture(orderId, sagaId, "PAYMENT_CONFIRMED", "dead-checkout", 0);

        outboxWorker.recoverStaleSagas();
        outboxWorker.recoverStaleSagas();

        verify(downstreamServiceClient, times(1)).commitInventory(eq(orderId));
        assertEquals("CONFIRMED", readOrderStatus(orderId));
        assertEquals("COMPLETED", readSagaState(sagaId));
    }

    private static Authentication authFor(String userId) {
        AuthPrincipal principal = new AuthPrincipal(userId, userId, "ROLE_USER");
        return new UsernamePasswordAuthenticationToken(principal, null,
                List.of(new SimpleGrantedAuthority(principal.role())));
    }

    private static Authentication adminAuth() {
        AuthPrincipal principal = new AuthPrincipal("admin-user", "admin", "ROLE_ADMIN");
        return new UsernamePasswordAuthenticationToken(principal, null,
                List.of(new SimpleGrantedAuthority(principal.role())));
    }

    private int countOrdersForUser(String userId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT COUNT(*) FROM orders WHERE user_id = ?")) {
            ps.setString(1, userId);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                return rs.getInt(1);
            }
        }
    }

    private void insertSagaFixture(String orderId, String sagaId, String state,
                                   String leaseOwner, long leaseExpiresAt) throws SQLException {
        insertSagaFixture(orderId, sagaId, state, leaseOwner, leaseExpiresAt, 0);
    }

    private void insertSagaFixture(String orderId, String sagaId, String state,
                                   String leaseOwner, long leaseExpiresAt,
                                   int commitAttempts) throws SQLException {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection()) {
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO orders (order_id, user_id, status, total_cents, created_at, updated_at) " +
                            "VALUES (?, ?, ?, ?, ?, ?)")) {
                ps.setString(1, orderId);
                ps.setString(2, "user-999");
                ps.setString(3, "PENDING");
                ps.setInt(4, 3500);
                ps.setLong(5, now);
                ps.setLong(6, now);
                ps.executeUpdate();
            }
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO saga_instances (id, order_id, current_state, error_reason, created_at, " +
                            "updated_at, lease_owner, lease_expires_at, version, commit_attempts) " +
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
                ps.setString(1, sagaId);
                ps.setString(2, orderId);
                ps.setString(3, state);
                ps.setString(4, null);
                ps.setLong(5, now);
                ps.setLong(6, now);
                ps.setString(7, leaseOwner);
                ps.setLong(8, leaseExpiresAt);
                ps.setInt(9, 1);
                ps.setInt(10, commitAttempts);
                ps.executeUpdate();
            }
        }
    }

    private String readOrderStatus(String orderId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT status FROM orders WHERE order_id = ?")) {
            ps.setString(1, orderId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString("status") : null;
            }
        }
    }

    private String readSagaState(String sagaId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT current_state FROM saga_instances WHERE id = ?")) {
            ps.setString(1, sagaId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString("current_state") : null;
            }
        }
    }

    @Test
    @DisplayName("Scenario 7: Inventory commit succeeds, but response is lost -> Retry succeeds, never refunds")
    void testScenario7_InventoryCommitSucceeds_ResponseLostRetry() throws Exception {
        String idemKey = "IDEM-SCENARIO-7-" + UUID.randomUUID();

        when(downstreamServiceClient.commitInventory(anyString()))
                .thenThrow(new ResourceAccessException("Read timed out"))
                .thenReturn(Map.of("status", "COMMITTED"));

        SagaOrchestrator.OrderItemDto item = new SagaOrchestrator.OrderItemDto("PROD-007", "SKU-007", 1, 12000);
        SagaOrchestrator.CheckoutRequest req = new SagaOrchestrator.CheckoutRequest("user-107", List.of(item), idemKey);

        ResponseEntity<Map<String, Object>> resp = orderController.checkout(req, authFor(req.userId()));
        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertEquals("CONFIRMED", resp.getBody().get("status"));

        verify(downstreamServiceClient, atLeast(2)).commitInventory(anyString());
        verify(downstreamServiceClient, never()).refundPayment(anyString(), anyInt(), anyString(), anyString());
    }

    @Test
    @DisplayName("M-03: exhausted inventory commits escalate to exactly one refund task and a REFUNDED order")
    void testCommitExhaustionEscalatesToSingleRefund() throws Exception {
        String orderId = "ord-m03-refund-" + UUID.randomUUID().toString().substring(0, 8);
        String sagaId = "saga-m03-refund-" + UUID.randomUUID().toString().substring(0, 8);
        insertSagaFixture(orderId, sagaId, "INVENTORY_COMMITTING", "dead-checkout", 0, 5);

        when(downstreamServiceClient.commitInventory(eq(orderId)))
                .thenThrow(new ResourceAccessException("inventory unavailable"));
        when(downstreamServiceClient.getPaymentByOrderId(eq(orderId)))
                .thenReturn(Optional.of(Map.of(
                        "paymentId", "pay-m03-123",
                        "amountCents", 3500,
                        "status", "CAPTURED")));

        recoverUntilState(sagaId, "COMPENSATING_PAYMENT");
        outboxWorker.recoverStaleSagas();
        outboxWorker.recoverStaleSagas();

        assertEquals(1, countRefundTasks(sagaId), "Exactly one refund task must be enqueued");
        assertEquals("REFUNDING", readOrderStatus(orderId));

        awaitTaskState(sagaId, "REFUND_PAYMENT", "COMPLETED");

        verify(downstreamServiceClient, times(1)).refundPayment(
                eq("pay-m03-123"), eq(3500), anyString(), eq("outbox-ref-pay-m03-123"));
        verify(downstreamServiceClient, atLeastOnce()).releaseInventory(eq(orderId), anyString());
        assertEquals("REFUNDED", readOrderStatus(orderId));
        assertEquals("REFUNDED", readSagaState(sagaId));
        assertEquals(1, countRefundTasks(sagaId));
    }

    @Test
    @DisplayName("M-03: a successful late inventory commit confirms the order and never refunds")
    void testLateCommitConfirmsWithoutRefund() throws Exception {
        String orderId = "ord-m03-late-" + UUID.randomUUID().toString().substring(0, 8);
        String sagaId = "saga-m03-late-" + UUID.randomUUID().toString().substring(0, 8);
        insertSagaFixture(orderId, sagaId, "INVENTORY_COMMITTING", "dead-checkout", 0, 5);

        when(downstreamServiceClient.commitInventory(eq(orderId)))
                .thenReturn(Map.of("status", "COMMITTED"));
        when(downstreamServiceClient.getPaymentByOrderId(eq(orderId)))
                .thenReturn(Optional.of(Map.of(
                        "paymentId", "pay-m03-late",
                        "amountCents", 3500,
                        "status", "CAPTURED")));

        recoverUntilState(sagaId, "COMPLETED");

        assertEquals("CONFIRMED", readOrderStatus(orderId));
        assertEquals(0, countRefundTasks(sagaId), "A successful commit must never enqueue a refund");
        verify(downstreamServiceClient, never()).refundPayment(
                anyString(), anyInt(), anyString(), anyString());
    }

    private void recoverUntilState(String sagaId, String expectedState) throws SQLException {
        for (int i = 0; i < 20 && !expectedState.equals(readSagaState(sagaId)); i++) {
            outboxWorker.recoverStaleSagas();
        }
        assertEquals(expectedState, readSagaState(sagaId));
    }

    private int countRefundTasks(String sagaId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT COUNT(*) FROM outbox_tasks WHERE saga_id = ? AND task_type = 'REFUND_PAYMENT'")) {
            ps.setString(1, sagaId);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                return rs.getInt(1);
            }
        }
    }

    private String readTaskState(String sagaId, String taskType) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT state FROM outbox_tasks WHERE saga_id = ? AND task_type = ? " +
                             "ORDER BY created_at DESC LIMIT 1")) {
            ps.setString(1, sagaId);
            ps.setString(2, taskType);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    private void awaitTaskState(String sagaId, String taskType, String expectedState) throws Exception {
        for (int i = 0; i < 60 && !expectedState.equals(readTaskState(sagaId, taskType)); i++) {
            outboxWorker.processOutboxTasks();
            Thread.sleep(20);
        }
        assertEquals(expectedState, readTaskState(sagaId, taskType));
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
                ps.setString(2, "user-999");
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

    @Test
    @DisplayName("M-01: outbox retries honor 2/4/8/16/32s backoff with jitter and dead-letter after five attempts")
    void testOutboxBackoffGatesRetriesAndDeadLetters() throws Exception {
        String orderId = "ord-m01-" + UUID.randomUUID().toString().substring(0, 8);
        String sagaId = "saga-m01-" + UUID.randomUUID().toString().substring(0, 8);
        String taskId = "task-m01-" + UUID.randomUUID().toString().substring(0, 8);

        // This test owns the outbox table: no other task may be selected by the
        // immediate second tick used to prove the backoff gate is honoured.
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {
            stmt.executeUpdate("DELETE FROM outbox_tasks");
        }
        insertSagaFixture(orderId, sagaId, "PAYMENT_CONFIRMED", null, 0);
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "INSERT INTO outbox_tasks (id, saga_id, task_type, payload, state, retries, " +
                             "created_at, updated_at, next_attempt_at) " +
                             "VALUES (?, ?, 'UNKNOWN_M01_TASK', '{}', 'PENDING', 0, 0, 0, 0)")) {
            ps.setString(1, taskId);
            ps.setString(2, sagaId);
            ps.executeUpdate();
        }

        double retriedBefore = meterRegistry.get("causalotel.outbox.tasks.retried").counter().count();
        double deadBefore = meterRegistry.get("causalotel.outbox.tasks.dead_lettered").counter().count();
        long jitterMs = Math.floorMod(taskId.hashCode(), 1000);
        long[] baseDelays = {2000L, 4000L, 8000L, 16000L, 32000L};

        for (int attempt = 1; attempt <= 5; attempt++) {
            clearSagaLease(sagaId);
            outboxWorker.processOutboxTasks();

            TaskRow row = readTaskRow(taskId);
            assertEquals(attempt, row.retries(), "retry count after attempt " + attempt);
            assertEquals(baseDelays[attempt - 1] + jitterMs, row.nextAttemptAt() - row.updatedAt(),
                    "attempt " + attempt + " must store the exponential delay plus per-task jitter");

            if (attempt < 5) {
                assertEquals("PENDING", row.state());
                outboxWorker.processOutboxTasks();
                assertEquals(attempt, readTaskRow(taskId).retries(),
                        "a pending task must not be retried before its backoff elapses");
                rewindTask(taskId);
            } else {
                assertEquals("FAILED", row.state(), "the fifth failure must dead-letter the task");
            }
        }

        assertEquals(5.0,
                meterRegistry.get("causalotel.outbox.tasks.retried").counter().count() - retriedBefore,
                0.0001, "every failed attempt must increment the retried counter");
        assertEquals(1.0,
                meterRegistry.get("causalotel.outbox.tasks.dead_lettered").counter().count() - deadBefore,
                0.0001, "dead-lettering must increment the dead-letter counter exactly once");
    }

    private void clearSagaLease(String sagaId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "UPDATE saga_instances SET lease_expires_at = 0 WHERE id = ?")) {
            ps.setString(1, sagaId);
            ps.executeUpdate();
        }
    }

    private void rewindTask(String taskId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "UPDATE outbox_tasks SET next_attempt_at = 0 WHERE id = ?")) {
            ps.setString(1, taskId);
            ps.executeUpdate();
        }
    }

    private TaskRow readTaskRow(String taskId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT state, retries, next_attempt_at, updated_at FROM outbox_tasks WHERE id = ?")) {
            ps.setString(1, taskId);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next(), "outbox task " + taskId + " must exist");
                return new TaskRow(rs.getString("state"), rs.getInt("retries"),
                        rs.getLong("next_attempt_at"), rs.getLong("updated_at"));
            }
        }
    }

    private record TaskRow(String state, int retries, long nextAttemptAt, long updatedAt) {
    }
}
