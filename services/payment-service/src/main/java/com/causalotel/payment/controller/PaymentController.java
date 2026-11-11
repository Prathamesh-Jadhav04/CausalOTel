package com.causalotel.payment.controller;

import com.causalotel.payment.service.PaymentGatewaySimulator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;

@RestController
@RequestMapping("/api/payments")
public class PaymentController {

    private final DataSource dataSource;
    private final PaymentGatewaySimulator gatewaySimulator;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final java.util.concurrent.ConcurrentHashMap<String, Object> paymentLocks = new java.util.concurrent.ConcurrentHashMap<>();

    public PaymentController(DataSource dataSource, PaymentGatewaySimulator gatewaySimulator) {
        this.dataSource = dataSource;
        this.gatewaySimulator = gatewaySimulator;
    }

    public record ChargeRequest(String orderId, int amountCents, String currency, String idempotencyKey) {}
    public record RefundRequest(String paymentId, int amountCents, String reason, String idempotencyKey) {}
    public record FaultConfig(Integer latencyMs, String faultMode, String errorMessage) {}

    private String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 algorithm unavailable", e);
        }
    }

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getPayments() throws SQLException {
        List<Map<String, Object>> payments = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, payment_id, order_id, amount_cents, currency, status, created_at, updated_at FROM payments ORDER BY created_at DESC");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                Map<String, Object> p = new HashMap<>();
                p.put("id", rs.getInt("id"));
                p.put("payment_id", rs.getString("payment_id"));
                p.put("order_id", rs.getString("order_id"));
                p.put("amount_cents", rs.getInt("amount_cents"));
                p.put("currency", rs.getString("currency"));
                p.put("status", rs.getString("status"));
                p.put("created_at", rs.getLong("created_at"));
                p.put("updated_at", rs.getLong("updated_at"));
                payments.add(p);
            }
        }
        return ResponseEntity.ok(payments);
    }

    @GetMapping("/{paymentId}")
    public ResponseEntity<Map<String, Object>> getPaymentByPaymentId(@PathVariable String paymentId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, payment_id, order_id, amount_cents, currency, status, created_at, updated_at FROM payments WHERE payment_id = ?")) {
            ps.setString(1, paymentId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    Map<String, Object> p = new HashMap<>();
                    p.put("id", rs.getInt("id"));
                    p.put("payment_id", rs.getString("payment_id"));
                    p.put("paymentId", rs.getString("payment_id"));
                    p.put("order_id", rs.getString("order_id"));
                    p.put("orderId", rs.getString("order_id"));
                    p.put("amount_cents", rs.getInt("amount_cents"));
                    p.put("amountCents", rs.getInt("amount_cents"));
                    p.put("currency", rs.getString("currency"));
                    p.put("status", rs.getString("status"));
                    p.put("created_at", rs.getLong("created_at"));
                    p.put("updated_at", rs.getLong("updated_at"));
                    return ResponseEntity.ok(p);
                }
            }
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Payment not found for paymentId: " + paymentId);
    }

    @GetMapping("/order/{orderId}")
    public ResponseEntity<Map<String, Object>> getPaymentByOrderId(@PathVariable String orderId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, payment_id, order_id, amount_cents, currency, status, created_at, updated_at FROM payments WHERE order_id = ?")) {
            ps.setString(1, orderId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    Map<String, Object> p = new HashMap<>();
                    p.put("id", rs.getInt("id"));
                    p.put("payment_id", rs.getString("payment_id"));
                    p.put("paymentId", rs.getString("payment_id"));
                    p.put("order_id", rs.getString("order_id"));
                    p.put("orderId", rs.getString("order_id"));
                    p.put("amount_cents", rs.getInt("amount_cents"));
                    p.put("amountCents", rs.getInt("amount_cents"));
                    p.put("currency", rs.getString("currency"));
                    p.put("status", rs.getString("status"));
                    p.put("created_at", rs.getLong("created_at"));
                    p.put("updated_at", rs.getLong("updated_at"));
                    return ResponseEntity.ok(p);
                }
            }
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Payment not found for orderId: " + orderId);
    }

    @PostMapping("/charge")
    public ResponseEntity<Map<String, Object>> charge(@RequestBody ChargeRequest request) throws Exception {
        if (request.orderId() == null || request.orderId().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "orderId must not be empty");
        }
        if (request.amountCents() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "amountCents must be positive");
        }
        String currency = (request.currency() != null && !request.currency().isBlank()) ? request.currency().toUpperCase() : "USD";
        if (!"USD".equals(currency)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only USD currency is supported");
        }
        String idempotencyKey = (request.idempotencyKey() != null && !request.idempotencyKey().isBlank())
                ? request.idempotencyKey()
                : "idem-charge-" + request.orderId();

        String requestHash = sha256(request.orderId() + ":" + request.amountCents() + ":" + currency);

        long now = System.currentTimeMillis();

        String paymentId = "pay-" + sha256(request.orderId()).substring(0, 16);
        String gatewayRef = "gw-" + sha256(request.orderId() + ":" + idempotencyKey).substring(0, 16);

        Object lock = paymentLocks.computeIfAbsent(paymentId, k -> new Object());
        synchronized (lock) {
            try {
                try (Connection conn = dataSource.getConnection()) {
                    conn.setAutoCommit(false);
                    try {
                        // 1. Idempotency Check
                try (PreparedStatement ps = conn.prepareStatement("SELECT request_hash, response_body FROM payment_idempotency WHERE idempotency_key = ?")) {
                    ps.setString(1, idempotencyKey);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next()) {
                            String existingHash = rs.getString("request_hash");
                            if (!requestHash.equals(existingHash)) {
                                conn.rollback();
                                throw new ResponseStatusException(HttpStatus.CONFLICT, "Idempotency key reused with different request parameters");
                            }
                            String cachedBody = rs.getString("response_body");
                            @SuppressWarnings("unchecked")
                            Map<String, Object> cachedMap = objectMapper.readValue(cachedBody, Map.class);
                            conn.rollback();
                            return ResponseEntity.ok(cachedMap);
                        }
                    }
                }

                // 2. Check if order already paid
                try (PreparedStatement ps = conn.prepareStatement("SELECT payment_id, status FROM payments WHERE order_id = ?")) {
                    ps.setString(1, request.orderId());
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next()) {
                            String existingStatus = rs.getString("status");
                            if ("CAPTURED".equals(existingStatus)) {
                                String pid = rs.getString("payment_id");
                                Map<String, Object> resp = new HashMap<>();
                                resp.put("paymentId", pid);
                                resp.put("orderId", request.orderId());
                                resp.put("amountCents", request.amountCents());
                                resp.put("currency", currency);
                                resp.put("status", "CAPTURED");
                                resp.put("idempotent", true);
                                conn.rollback();
                                return ResponseEntity.ok(resp);
                            }
                        }
                    }
                }

                // 3. Apply Simulated Gateway Behavior (Latency / Decline / Timeout / 503)
                gatewaySimulator.applySimulation();

                // 4. Record Successful Payment
                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO payments (payment_id, order_id, amount_cents, currency, status, refunded_amount_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")) {
                    ps.setString(1, paymentId);
                    ps.setString(2, request.orderId());
                    ps.setInt(3, request.amountCents());
                    ps.setString(4, currency);
                    ps.setString(5, "CAPTURED");
                    ps.setInt(6, 0);
                    ps.setLong(7, now);
                    ps.setLong(8, now);
                    ps.executeUpdate();
                }

                // 5. Record Attempt
                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO payment_attempts (payment_id, attempt_number, status, gateway_reference, gateway_response_code, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")) {
                    ps.setString(1, paymentId);
                    ps.setInt(2, 1);
                    ps.setString(3, "SUCCESS");
                    ps.setString(4, gatewayRef);
                    ps.setString(5, "APPROVED");
                    ps.setString(6, null);
                    ps.setLong(7, now);
                    ps.executeUpdate();
                }

                Map<String, Object> responseMap = new HashMap<>();
                responseMap.put("paymentId", paymentId);
                responseMap.put("orderId", request.orderId());
                responseMap.put("amountCents", request.amountCents());
                responseMap.put("currency", currency);
                responseMap.put("status", "CAPTURED");
                responseMap.put("createdAt", now);

                // 6. Record Idempotency
                String jsonResponse = objectMapper.writeValueAsString(responseMap);
                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO payment_idempotency (idempotency_key, payment_id, request_hash, response_body, created_at) VALUES (?, ?, ?, ?, ?)")) {
                    ps.setString(1, idempotencyKey);
                    ps.setString(2, paymentId);
                    ps.setString(3, requestHash);
                    ps.setString(4, jsonResponse);
                    ps.setLong(5, now);
                    ps.executeUpdate();
                }

                conn.commit();
                return ResponseEntity.ok(responseMap);
            } catch (Exception e) {
                conn.rollback();
                throw e;
            }
        }
            } finally {
                paymentLocks.remove(paymentId);
            }
        }
    }

    @PostMapping("/refund")
    public ResponseEntity<Map<String, Object>> refund(@RequestBody RefundRequest request) throws Exception {
        if (request.paymentId() == null || request.paymentId().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "paymentId must not be empty");
        }
        if (request.amountCents() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "amountCents must be positive");
        }
        String idempotencyKey = (request.idempotencyKey() != null && !request.idempotencyKey().isBlank())
                ? request.idempotencyKey()
                : "idem-ref-" + request.paymentId() + "-" + request.amountCents();

        String requestHash = sha256(request.paymentId() + ":" + request.amountCents());
        long now = System.currentTimeMillis();

        Object lock = paymentLocks.computeIfAbsent(request.paymentId(), k -> new Object());
        synchronized (lock) {
            try {
                try (Connection conn = dataSource.getConnection()) {
                    conn.setAutoCommit(false);
                    try {
                        // 1. Idempotency Check
                try (PreparedStatement ps = conn.prepareStatement("SELECT request_hash, response_body FROM payment_idempotency WHERE idempotency_key = ?")) {
                    ps.setString(1, idempotencyKey);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next()) {
                            String existingHash = rs.getString("request_hash");
                            if (!requestHash.equals(existingHash)) {
                                conn.rollback();
                                throw new ResponseStatusException(HttpStatus.CONFLICT, "Idempotency key reused with different refund parameters");
                            }
                            String cachedBody = rs.getString("response_body");
                            @SuppressWarnings("unchecked")
                            Map<String, Object> cachedMap = objectMapper.readValue(cachedBody, Map.class);
                            conn.rollback();
                            return ResponseEntity.ok(cachedMap);
                        }
                    }
                }

                // 2. Fetch Payment
                int capturedAmountCents = 0;
                try (PreparedStatement ps = conn.prepareStatement("SELECT amount_cents, status FROM payments WHERE payment_id = ?")) {
                    ps.setString(1, request.paymentId());
                    try (ResultSet rs = ps.executeQuery()) {
                        if (!rs.next()) {
                            conn.rollback();
                            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Payment not found for paymentId: " + request.paymentId());
                        }
                        capturedAmountCents = rs.getInt("amount_cents");
                    }
                }

                // 3. Compute Already Refunded Sum
                int alreadyRefundedCents = 0;
                try (PreparedStatement ps = conn.prepareStatement("SELECT COALESCE(SUM(amount_cents), 0) as total_refunded FROM refunds WHERE payment_id = ? AND status = 'COMPLETED'")) {
                    ps.setString(1, request.paymentId());
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next()) {
                            alreadyRefundedCents = rs.getInt("total_refunded");
                        }
                    }
                }

                // 4. Strict Financial Invariant Enforcement
                int projectedTotal = alreadyRefundedCents + request.amountCents();
                if (projectedTotal > capturedAmountCents) {
                    conn.rollback();
                    throw new ResponseStatusException(
                            HttpStatus.UNPROCESSABLE_ENTITY,
                            String.format("Refund amount exceeds captured payment. Captured: %d cents, Already refunded: %d cents, Requested: %d cents",
                                    capturedAmountCents, alreadyRefundedCents, request.amountCents())
                    );
                }

                // 5. Insert Refund Record
                String refundId = "ref-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO refunds (refund_id, payment_id, amount_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")) {
                    ps.setString(1, refundId);
                    ps.setString(2, request.paymentId());
                    ps.setInt(3, request.amountCents());
                    ps.setString(4, "COMPLETED");
                    ps.setLong(5, now);
                    ps.setLong(6, now);
                    ps.executeUpdate();
                }

                // 6. Update Payment Status & Cumulative Refunded Amount
                String newPaymentStatus = (projectedTotal == capturedAmountCents) ? "REFUNDED" : "PARTIALLY_REFUNDED";
                try (PreparedStatement ps = conn.prepareStatement(
                        "UPDATE payments SET status = ?, refunded_amount_cents = ?, updated_at = ? WHERE payment_id = ? AND ? <= amount_cents")) {
                    ps.setString(1, newPaymentStatus);
                    ps.setInt(2, projectedTotal);
                    ps.setLong(3, now);
                    ps.setString(4, request.paymentId());
                    ps.setInt(5, projectedTotal);
                    int updatedRows = ps.executeUpdate();
                    if (updatedRows == 0) {
                        conn.rollback();
                        throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Cumulative refund amount would exceed captured payment");
                    }
                }

                Map<String, Object> responseMap = new HashMap<>();
                responseMap.put("refundId", refundId);
                responseMap.put("paymentId", request.paymentId());
                responseMap.put("amountCents", request.amountCents());
                responseMap.put("status", "COMPLETED");
                responseMap.put("paymentStatus", newPaymentStatus);
                responseMap.put("reason", request.reason() != null ? request.reason() : "Customer request");
                responseMap.put("createdAt", now);

                // 7. Store Idempotency
                String jsonResponse = objectMapper.writeValueAsString(responseMap);
                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO payment_idempotency (idempotency_key, payment_id, request_hash, response_body, created_at) VALUES (?, ?, ?, ?, ?)")) {
                    ps.setString(1, idempotencyKey);
                    ps.setString(2, request.paymentId());
                    ps.setString(3, requestHash);
                    ps.setString(4, jsonResponse);
                    ps.setLong(5, now);
                    ps.executeUpdate();
                }

                conn.commit();
                return ResponseEntity.ok(responseMap);
            } catch (Exception e) {
                conn.rollback();
                throw e;
            }
        }
            } finally {
                paymentLocks.remove(request.paymentId());
            }
        }
    }

    @PostMapping("/fault")
    public ResponseEntity<Map<String, Object>> setFault(@RequestBody FaultConfig config) {
        if (config.latencyMs() != null) {
            gatewaySimulator.setLatencyMs(config.latencyMs());
        }
        if (config.faultMode() != null) {
            try {
                gatewaySimulator.setFaultMode(PaymentGatewaySimulator.FaultMode.valueOf(config.faultMode().toUpperCase()));
            } catch (IllegalArgumentException e) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown faultMode: " + config.faultMode());
            }
        } else {
            gatewaySimulator.setFaultMode(PaymentGatewaySimulator.FaultMode.NORMAL);
        }
        gatewaySimulator.setCustomErrorMessage(config.errorMessage());

        Map<String, Object> resp = new HashMap<>();
        resp.put("status", "UPDATED");
        resp.put("latencyMs", gatewaySimulator.getLatencyMs());
        resp.put("faultMode", gatewaySimulator.getFaultMode().name());
        resp.put("customErrorMessage", gatewaySimulator.getCustomErrorMessage());
        return ResponseEntity.ok(resp);
    }

    @GetMapping("/fault")
    public ResponseEntity<Map<String, Object>> getFault() {
        Map<String, Object> resp = new HashMap<>();
        resp.put("latencyMs", gatewaySimulator.getLatencyMs());
        resp.put("faultMode", gatewaySimulator.getFaultMode().name());
        resp.put("customErrorMessage", gatewaySimulator.getCustomErrorMessage());
        return ResponseEntity.ok(resp);
    }
}
