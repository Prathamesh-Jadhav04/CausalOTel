package com.causalotel.order.service;

import com.causalotel.order.client.DownstreamServiceClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SagaOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(SagaOrchestrator.class);

    private final DataSource dataSource;
    private final DownstreamServiceClient downstreamClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final ConcurrentHashMap<String, Object> inFlightKeys = new ConcurrentHashMap<>();

    public SagaOrchestrator(DataSource dataSource, DownstreamServiceClient downstreamClient) {
        this.dataSource = dataSource;
        this.downstreamClient = downstreamClient;
    }

    public record OrderItemDto(String productId, String sku, int quantity, int priceCents) {}
    public record CheckoutRequest(int userId, List<OrderItemDto> items, String idempotencyKey) {}

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

    public Map<String, Object> checkout(CheckoutRequest request) throws Exception {
        if (request.items() == null || request.items().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Checkout items cannot be empty");
        }

        int totalCents = 0;
        for (OrderItemDto item : request.items()) {
            if (item.quantity() <= 0 || item.priceCents() < 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid item quantity or price");
            }
            totalCents += (item.quantity() * item.priceCents());
        }

        String idempotencyKey = (request.idempotencyKey() != null && !request.idempotencyKey().isBlank())
                ? request.idempotencyKey()
                : "idem-chk-" + UUID.randomUUID();

        String requestHash = sha256(request.userId() + ":" + totalCents + ":" + request.items().size());
        long now = System.currentTimeMillis();

        // Concurrency control for duplicate simultaneous checkouts (Scenario 5)
        Object lock = inFlightKeys.computeIfAbsent(idempotencyKey, k -> new Object());
        synchronized (lock) {
            try {
                // 1. Check Idempotency Table
                try (Connection conn = dataSource.getConnection()) {
                    try (PreparedStatement ps = conn.prepareStatement("SELECT request_hash, response_status, response_body FROM order_idempotency WHERE idempotency_key = ?")) {
                        ps.setString(1, idempotencyKey);
                        try (ResultSet rs = ps.executeQuery()) {
                            if (rs.next()) {
                                String existingHash = rs.getString("request_hash");
                                if (!requestHash.equals(existingHash)) {
                                    throw new ResponseStatusException(HttpStatus.CONFLICT, "Idempotency key reused with different checkout parameters");
                                }
                                String cachedBody = rs.getString("response_body");
                                @SuppressWarnings("unchecked")
                                Map<String, Object> cachedMap = objectMapper.readValue(cachedBody, Map.class);
                                return cachedMap;
                            }
                        }
                    }
                }

                // Deterministic orderId and sagaId derived from idempotencyKey
                String keyHash = sha256(idempotencyKey);
                String orderId = "ord-" + keyHash.substring(0, 16);
                String sagaId = "saga-" + keyHash.substring(0, 16);

                // Check if order already exists in orders table
                try (Connection conn = dataSource.getConnection();
                     PreparedStatement ps = conn.prepareStatement("SELECT status, total_cents, user_id FROM orders WHERE order_id = ?")) {
                    ps.setString(1, orderId);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next()) {
                            String status = rs.getString("status");
                            int existingTotal = rs.getInt("total_cents");
                            int existingUser = rs.getInt("user_id");
                            if ("CONFIRMED".equalsIgnoreCase(status)) {
                                Map<String, Object> resp = new HashMap<>();
                                resp.put("orderId", orderId);
                                resp.put("userId", existingUser);
                                resp.put("status", "CONFIRMED");
                                resp.put("totalCents", existingTotal);
                                resp.put("sagaId", sagaId);
                                resp.put("createdAt", now);
                                return resp;
                            } else if ("PENDING_RECONCILIATION".equalsIgnoreCase(status)) {
                                throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT, "Order is undergoing payment reconciliation");
                            }
                        }
                    }
                }

                // 2. Initialize Order & Saga Instance in Local DB
                try (Connection conn = dataSource.getConnection()) {
                    conn.setAutoCommit(false);
                    try {
                        try (PreparedStatement ps = conn.prepareStatement(
                                "INSERT INTO orders (order_id, user_id, status, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")) {
                            ps.setString(1, orderId);
                            ps.setInt(2, request.userId());
                            ps.setString(3, "PENDING");
                            ps.setInt(4, totalCents);
                            ps.setLong(5, now);
                            ps.setLong(6, now);
                            ps.executeUpdate();
                        }

                        try (PreparedStatement ps = conn.prepareStatement(
                                "INSERT INTO order_items (order_id, sku, quantity, price_cents) VALUES (?, ?, ?, ?)")) {
                            for (OrderItemDto item : request.items()) {
                                ps.setString(1, orderId);
                                ps.setString(2, item.sku());
                                ps.setInt(3, item.quantity());
                                ps.setInt(4, item.priceCents());
                                ps.addBatch();
                            }
                            ps.executeBatch();
                        }

                        try (PreparedStatement ps = conn.prepareStatement(
                                "INSERT INTO saga_instances (id, order_id, current_state, error_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")) {
                            ps.setString(1, sagaId);
                            ps.setString(2, orderId);
                            ps.setString(3, "STARTED");
                            ps.setString(4, null);
                            ps.setLong(5, now);
                            ps.setLong(6, now);
                            ps.executeUpdate();
                        }

                        conn.commit();
                    } catch (Exception e) {
                        conn.rollback();
                        // If order already exists due to concurrent insert, re-check order status
                        try (PreparedStatement ps = conn.prepareStatement("SELECT status FROM orders WHERE order_id = ?")) {
                            ps.setString(1, orderId);
                            try (ResultSet rs = ps.executeQuery()) {
                                if (rs.next() && "CONFIRMED".equalsIgnoreCase(rs.getString("status"))) {
                                    Map<String, Object> resp = new HashMap<>();
                                    resp.put("orderId", orderId);
                                    resp.put("userId", request.userId());
                                    resp.put("status", "CONFIRMED");
                                    resp.put("totalCents", totalCents);
                                    resp.put("sagaId", sagaId);
                                    resp.put("createdAt", now);
                                    return resp;
                                }
                            }
                        }
                        throw e;
                    }
                }

                String paymentId = null;

                // 3. Step 1: Reserve Inventory
                try {
                    updateSagaState(sagaId, "INVENTORY_RESERVING", null);

                    List<Map<String, Object>> reserveItems = new ArrayList<>();
                    for (OrderItemDto item : request.items()) {
                        reserveItems.add(Map.of("sku", item.sku(), "quantity", item.quantity()));
                    }

                    Map<String, Object> invResp = downstreamClient.reserveInventory(orderId, reserveItems);
                    updateSagaState(sagaId, "INVENTORY_RESERVED", null);
                } catch (Exception e) {
                    log.error("Saga Step 1 (Reserve Inventory) failed for order {}: {}", orderId, e.getMessage());
                    updateOrderStatus(orderId, "FAILED");
                    updateSagaState(sagaId, "FAILED", "Inventory reservation failed: " + e.getMessage());
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "Unable to reserve inventory: " + e.getMessage(), e);
                }

                // 4. Step 2: Charge Payment
                try {
                    updateSagaState(sagaId, "PAYMENT_PROCESSING", null);
                    String payIdemKey = "pay-" + orderId;
                    Map<String, Object> payResp = downstreamClient.chargePayment(orderId, totalCents, "USD", payIdemKey);
                    paymentId = (String) payResp.get("paymentId");
                    updateSagaState(sagaId, "PAYMENT_CONFIRMED", null);
                } catch (Exception e) {
                    log.warn("Saga Step 2 payment charge call threw exception for order {}: {}", orderId, e.getMessage());

                    // Check if payment was definitively declined (Scenario 3)
                    if (DownstreamServiceClient.isDefinitivePaymentDecline(e)) {
                        log.error("Payment definitively declined for order {}: {}. Triggering safe compensation.", orderId, e.getMessage());
                        updateSagaState(sagaId, "COMPENSATING_INVENTORY", e.getMessage());

                        try {
                            downstreamClient.releaseInventory(orderId, "Payment declined: " + e.getMessage());
                        } catch (Exception compEx) {
                            log.error("Direct compensation failed. Enqueuing outbox task.", compEx);
                            enqueueOutboxTask(sagaId, "RELEASE_INVENTORY", Map.of("orderId", orderId, "reason", "Payment declined"));
                        }

                        updateOrderStatus(orderId, "CANCELLED");
                        updateSagaState(sagaId, "FAILED", "Payment charge declined: " + e.getMessage());
                        throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Payment processing failed: " + e.getMessage(), e);
                    }

                    // Payment outcome is unknown (HTTP 504, 503, connection drop/timeout) (Scenario 1, 2, 4)
                    // Business rule: HTTP 504 does not prove payment failure; never release inventory blindly!
                    log.warn("Unknown payment outcome for order {}. Checking payment record with Payment Service...", orderId);
                    Optional<Map<String, Object>> paymentRecordOpt = Optional.empty();
                    try {
                        paymentRecordOpt = downstreamClient.getPaymentByOrderId(orderId);
                    } catch (Exception queryEx) {
                        log.warn("Could not retrieve payment record for order {}: {}", orderId, queryEx.getMessage());
                    }

                    if (paymentRecordOpt.isPresent() && "CAPTURED".equalsIgnoreCase((String) paymentRecordOpt.get().get("status"))) {
                        // Payment actually SUCCEEDED! Reconciled successfully. (Scenario 1 & 2)
                        Map<String, Object> paymentRecord = paymentRecordOpt.get();
                        paymentId = (String) paymentRecord.get("paymentId");
                        log.info("Reconciliation confirmed payment was CAPTURED for order {}. paymentId={}", orderId, paymentId);
                        updateSagaState(sagaId, "PAYMENT_CONFIRMED", null);
                    } else {
                        // Payment outcome remains unconfirmed. Move to reconciliation state. (Scenario 4)
                        log.warn("Payment outcome unresolved for order {}. Moving order to PENDING_RECONCILIATION and saga to RECONCILIATION_REQUIRED.", orderId);
                        updateOrderStatus(orderId, "PENDING_RECONCILIATION");
                        updateSagaState(sagaId, "RECONCILIATION_REQUIRED", "Payment outcome unknown: " + e.getMessage());

                        enqueueOutboxTask(sagaId, "RECONCILE_PAYMENT", Map.of(
                                "orderId", orderId,
                                "totalCents", totalCents,
                                "sagaId", sagaId
                        ));

                        throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT, "Payment outcome unknown. Order entered reconciliation.", e);
                    }
                }

                // 5. Step 3: Commit Inventory (Scenario 7)
                boolean committed = false;
                int commitAttempts = 0;
                while (!committed && commitAttempts < 3) {
                    commitAttempts++;
                    try {
                        updateSagaState(sagaId, "INVENTORY_COMMITTING", null);
                        downstreamClient.commitInventory(orderId);
                        committed = true;
                    } catch (Exception e) {
                        log.warn("Commit inventory attempt {} failed for order {}: {}", commitAttempts, orderId, e.getMessage());
                        if (commitAttempts >= 3) {
                            // Enqueue COMMIT_INVENTORY outbox task instead of blind refund
                            log.error("Commit inventory attempts exhausted for order {}. Enqueuing COMMIT_INVENTORY outbox task.", orderId);
                            enqueueOutboxTask(sagaId, "COMMIT_INVENTORY", Map.of("orderId", orderId, "sagaId", sagaId));
                            throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT, "Inventory commit in progress. Order will be confirmed asynchronously.", e);
                        }
                        try {
                            Thread.sleep(50);
                        } catch (InterruptedException ie) {
                            Thread.currentThread().interrupt();
                        }
                    }
                }

                updateSagaState(sagaId, "COMPLETED", null);
                updateOrderStatus(orderId, "CONFIRMED");

                // 6. Return Confirmed Order Response & Record Idempotency
                Map<String, Object> responseMap = new HashMap<>();
                responseMap.put("orderId", orderId);
                responseMap.put("userId", request.userId());
                responseMap.put("status", "CONFIRMED");
                responseMap.put("totalCents", totalCents);
                responseMap.put("paymentId", paymentId);
                responseMap.put("sagaId", sagaId);
                responseMap.put("createdAt", now);

                try (Connection conn = dataSource.getConnection()) {
                    String jsonResp = objectMapper.writeValueAsString(responseMap);
                    try (PreparedStatement ps = conn.prepareStatement(
                            "INSERT OR REPLACE INTO order_idempotency (idempotency_key, order_id, request_hash, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?)")) {
                        ps.setString(1, idempotencyKey);
                        ps.setString(2, orderId);
                        ps.setString(3, requestHash);
                        ps.setInt(4, 200);
                        ps.setString(5, jsonResp);
                        ps.setLong(6, now);
                        ps.executeUpdate();
                    }
                }

                return responseMap;
            } finally {
                inFlightKeys.remove(idempotencyKey);
            }
        }
    }

    public void updateSagaState(String sagaId, String state, String errorReason) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("UPDATE saga_instances SET current_state = ?, error_reason = ?, updated_at = ? WHERE id = ?")) {
            ps.setString(1, state);
            ps.setString(2, errorReason);
            ps.setLong(3, now);
            ps.setString(4, sagaId);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Failed to update saga state {} for saga {}", state, sagaId, e);
        }
    }

    public void updateOrderStatus(String orderId, String status) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ?")) {
            ps.setString(1, status);
            ps.setLong(2, now);
            ps.setString(3, orderId);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Failed to update order status {} for order {}", status, orderId, e);
        }
    }

    public void enqueueOutboxTask(String sagaId, String taskType, Map<String, Object> payload) {
        long now = System.currentTimeMillis();
        String taskId = UUID.randomUUID().toString();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "INSERT INTO outbox_tasks (id, saga_id, task_type, payload, state, lease_expires_at, fencing_token, retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
            ps.setString(1, taskId);
            ps.setString(2, sagaId);
            ps.setString(3, taskType);
            ps.setString(4, objectMapper.writeValueAsString(payload));
            ps.setString(5, "PENDING");
            ps.setLong(6, 0);
            ps.setInt(7, 0);
            ps.setInt(8, 0);
            ps.setLong(9, now);
            ps.setLong(10, now);
            ps.executeUpdate();
            log.info("Enqueued outbox task {} for saga {}", taskType, sagaId);
        } catch (Exception e) {
            log.error("Failed to enqueue outbox task", e);
        }
    }
}
