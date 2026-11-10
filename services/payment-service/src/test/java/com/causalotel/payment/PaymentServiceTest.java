package com.causalotel.payment;

import com.causalotel.payment.controller.HealthController;
import com.causalotel.payment.controller.PaymentController;
import com.causalotel.payment.service.PaymentGatewaySimulator;
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
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class PaymentServiceTest {

    @Autowired
    private HealthController healthController;

    @Autowired
    private PaymentController paymentController;

    @Autowired
    private PaymentGatewaySimulator gatewaySimulator;

    @Autowired
    private DataSource dataSource;

    @BeforeEach
    void setup() {
        gatewaySimulator.reset();
    }

    @Test
    @DisplayName("Payment service context loads successfully")
    void contextLoads() {
        assertNotNull(healthController);
        assertNotNull(paymentController);
        assertNotNull(dataSource);
        assertNotNull(gatewaySimulator);
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
    @DisplayName("Flyway schema migration created payments, refunds, payment_attempts, and payment_idempotency tables")
    void testTablesExist() throws SQLException {
        try (Connection conn = dataSource.getConnection()) {
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "payments", null)) {
                assertTrue(rs.next(), "Table 'payments' should exist");
            }
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "refunds", null)) {
                assertTrue(rs.next(), "Table 'refunds' should exist");
            }
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "payment_attempts", null)) {
                assertTrue(rs.next(), "Table 'payment_attempts' should exist");
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

    @Test
    @DisplayName("POST /api/payments/charge succeeds and is idempotent on repeat request")
    void testChargeAndIdempotency() throws Exception {
        String orderId = "ORD-TEST-" + UUID.randomUUID();
        String idemKey = "IDEM-TEST-" + UUID.randomUUID();

        PaymentController.ChargeRequest req = new PaymentController.ChargeRequest(orderId, 5000, "USD", idemKey);
        ResponseEntity<Map<String, Object>> response = paymentController.charge(req);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("CAPTURED", response.getBody().get("status"));
        String paymentId = (String) response.getBody().get("paymentId");
        assertNotNull(paymentId);

        // Duplicate call with exact same idempotency key and payload returns cached response
        ResponseEntity<Map<String, Object>> dupResponse = paymentController.charge(req);
        assertEquals(HttpStatus.OK, dupResponse.getStatusCode());
        assertEquals(paymentId, dupResponse.getBody().get("paymentId"));

        // Call with same idempotency key but different payload fails with 409 CONFLICT
        PaymentController.ChargeRequest conflictReq = new PaymentController.ChargeRequest(orderId, 9999, "USD", idemKey);
        ResponseStatusException conflictEx = assertThrows(ResponseStatusException.class, () ->
                paymentController.charge(conflictReq)
        );
        assertEquals(HttpStatus.CONFLICT, conflictEx.getStatusCode());
    }

    @Test
    @DisplayName("POST /api/payments/refund enforces financial invariants and status transitions")
    void testRefundWorkflow() throws Exception {
        String orderId = "ORD-REF-" + UUID.randomUUID();
        String idemKey = "IDEM-REF-" + UUID.randomUUID();

        PaymentController.ChargeRequest chargeReq = new PaymentController.ChargeRequest(orderId, 10000, "USD", idemKey);
        ResponseEntity<Map<String, Object>> chargeResp = paymentController.charge(chargeReq);
        String paymentId = (String) chargeResp.getBody().get("paymentId");

        // Partial Refund of 4000 cents
        PaymentController.RefundRequest partialRefund = new PaymentController.RefundRequest(paymentId, 4000, "Damaged item", "IDEM-PARTIAL-" + UUID.randomUUID());
        ResponseEntity<Map<String, Object>> refResp1 = paymentController.refund(partialRefund);
        assertEquals(HttpStatus.OK, refResp1.getStatusCode());
        assertEquals("PARTIALLY_REFUNDED", refResp1.getBody().get("paymentStatus"));

        // Attempting to refund 7000 cents (exceeding total of 10000) throws 422 UNPROCESSABLE_ENTITY
        PaymentController.RefundRequest excessiveRefund = new PaymentController.RefundRequest(paymentId, 7000, "Too much", "IDEM-EXCESS-" + UUID.randomUUID());
        ResponseStatusException excessEx = assertThrows(ResponseStatusException.class, () ->
                paymentController.refund(excessiveRefund)
        );
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, excessEx.getStatusCode());

        // Remaining Refund of 6000 cents transitions payment to REFUNDED
        PaymentController.RefundRequest finalRefund = new PaymentController.RefundRequest(paymentId, 6000, "Remaining", "IDEM-FINAL-" + UUID.randomUUID());
        ResponseEntity<Map<String, Object>> refResp2 = paymentController.refund(finalRefund);
        assertEquals(HttpStatus.OK, refResp2.getStatusCode());
        assertEquals("REFUNDED", refResp2.getBody().get("paymentStatus"));
    }

    @Test
    @DisplayName("Simulated gateway decline throws PaymentDeclinedException")
    void testSimulatedDecline() {
        gatewaySimulator.setFaultMode(PaymentGatewaySimulator.FaultMode.DECLINED);
        gatewaySimulator.setCustomErrorMessage("Simulated insufficient funds");

        PaymentController.ChargeRequest req = new PaymentController.ChargeRequest("ORD-FAIL-" + UUID.randomUUID(), 5000, "USD", "IDEM-FAIL-" + UUID.randomUUID());
        assertThrows(PaymentGatewaySimulator.PaymentDeclinedException.class, () ->
                paymentController.charge(req)
        );
    }

    @Test
    @DisplayName("Simulated gateway timeout throws GatewayTimeoutException")
    void testSimulatedTimeout() {
        gatewaySimulator.setFaultMode(PaymentGatewaySimulator.FaultMode.GATEWAY_TIMEOUT);

        PaymentController.ChargeRequest req = new PaymentController.ChargeRequest("ORD-TIMEOUT-" + UUID.randomUUID(), 5000, "USD", "IDEM-TIMEOUT-" + UUID.randomUUID());
        assertThrows(PaymentGatewaySimulator.GatewayTimeoutException.class, () ->
                paymentController.charge(req)
        );
    }

    @Test
    @DisplayName("GET /api/payments/order/{orderId} returns payment record for reconciliation")
    void testPaymentLookupByOrderId() throws Exception {
        String orderId = "ORD-LOOKUP-" + UUID.randomUUID();
        PaymentController.ChargeRequest req = new PaymentController.ChargeRequest(orderId, 12500, "USD", "IDEM-LOOKUP-" + UUID.randomUUID());
        ResponseEntity<Map<String, Object>> chargeResp = paymentController.charge(req);
        assertEquals(HttpStatus.OK, chargeResp.getStatusCode());

        ResponseEntity<Map<String, Object>> lookupResp = paymentController.getPaymentByOrderId(orderId);
        assertEquals(HttpStatus.OK, lookupResp.getStatusCode());
        assertNotNull(lookupResp.getBody());
        assertEquals(orderId, lookupResp.getBody().get("orderId"));
        assertEquals("CAPTURED", lookupResp.getBody().get("status"));
        assertEquals(12500, lookupResp.getBody().get("amountCents"));
    }

    @Test
    @DisplayName("Scenario 10: Two refund requests arrive simultaneously -> Total refunded never exceeds captured amount")
    void testScenario10_TwoRefundRequestsArriveSimultaneously() throws Exception {
        String orderId = "ORD-CONC-REF-" + UUID.randomUUID();
        int capturedCents = 10000; // $100.00

        // Charge $100
        PaymentController.ChargeRequest chargeReq = new PaymentController.ChargeRequest(
                orderId, capturedCents, "USD", "IDEM-CONC-CHARGE-" + UUID.randomUUID()
        );
        ResponseEntity<Map<String, Object>> chargeResp = paymentController.charge(chargeReq);
        assertEquals(HttpStatus.OK, chargeResp.getStatusCode());
        String paymentId = (String) chargeResp.getBody().get("paymentId");
        assertNotNull(paymentId);

        // Prepare 2 genuinely concurrent refund requests of 6000 cents ($60) each
        // If both succeeded, $120 would be refunded on a $100 payment!
        int refundAttemptCents = 6000;
        int numThreads = 2;
        ExecutorService executor = Executors.newFixedThreadPool(numThreads);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(numThreads);

        List<Future<Integer>> futures = new ArrayList<>();
        for (int i = 0; i < numThreads; i++) {
            final int index = i;
            futures.add(executor.submit(() -> {
                startLatch.await();
                try {
                    PaymentController.RefundRequest refundReq = new PaymentController.RefundRequest(
                            paymentId, refundAttemptCents, "Simultaneous refund attempt " + index, "IDEM-SIM-REF-" + index + "-" + UUID.randomUUID()
                    );
                    ResponseEntity<Map<String, Object>> refResp = paymentController.refund(refundReq);
                    return refResp.getStatusCode().value();
                } catch (ResponseStatusException rse) {
                    return rse.getStatusCode().value();
                } finally {
                    doneLatch.countDown();
                }
            }));
        }

        startLatch.countDown();
        assertTrue(doneLatch.await(10, TimeUnit.SECONDS), "Concurrent refund requests must complete");
        executor.shutdown();

        int status1 = futures.get(0).get();
        int status2 = futures.get(1).get();

        // Exactly one should succeed (200 OK) and one must be rejected (422 Unprocessable Entity)
        assertTrue(
                (status1 == 200 && status2 == 422) || (status1 == 422 && status2 == 200),
                "Exactly one concurrent refund should succeed (200) and one must fail (422). Got: " + status1 + " and " + status2
        );

        // Verify total refunded amount in database
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT refunded_amount_cents, status FROM payments WHERE payment_id = ?")) {
            ps.setString(1, paymentId);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                int refunded = rs.getInt("refunded_amount_cents");
                assertEquals(6000, refunded, "Total refunded amount must be exactly 6000 cents, never 12000 cents");
                assertEquals("PARTIALLY_REFUNDED", rs.getString("status"));
            }
        }
    }
}
