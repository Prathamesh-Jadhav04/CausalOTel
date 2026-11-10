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

@Service
public class SagaOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(SagaOrchestrator.class);

    private final DataSource dataSource;
    private final DownstreamServiceClient downstreamClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

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

        // 1. Check Idempotency
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

        String orderId = "ord-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        String sagaId = "saga-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);

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
                throw e;
            }
        }

        String paymentId = null;
        boolean inventoryReserved = false;

        // 3. Step 1: Reserve Inventory
        try {
            updateSagaState(sagaId, "INVENTORY_RESERVING", null);

            List<Map<String, Object>> reserveItems = new ArrayList<>();
            for (OrderItemDto item : request.items()) {
                reserveItems.add(Map.of("sku", item.sku(), "quantity", item.quantity()));
            }

            Map<String, Object> invResp = downstreamClient.reserveInventory(orderId, reserveItems);
            inventoryReserved = true;
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
            log.error("Saga Step 2 (Payment Charge) failed for order {}: {}. Triggering compensation.", orderId, e.getMessage());
            updateSagaState(sagaId, "COMPENSATING_INVENTORY", e.getMessage());

            // Compensation: Release Inventory
            try {
                downstreamClient.releaseInventory(orderId, "Payment failed: " + e.getMessage());
            } catch (Exception compEx) {
                log.error("Direct compensation failed. Enqueuing outbox task for eventual consistency.", compEx);
                enqueueOutboxTask(sagaId, "RELEASE_INVENTORY", Map.of("orderId", orderId, "reason", "Payment failed"));
            }

            updateOrderStatus(orderId, "CANCELLED");
            updateSagaState(sagaId, "FAILED", "Payment charge failed: " + e.getMessage());
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Payment processing failed: " + e.getMessage(), e);
        }

        // 5. Step 3: Commit Inventory
        try {
            updateSagaState(sagaId, "INVENTORY_COMMITTING", null);
            downstreamClient.commitInventory(orderId);
            updateSagaState(sagaId, "COMPLETED", null);
            updateOrderStatus(orderId, "CONFIRMED");
        } catch (Exception e) {
            log.error("Saga Step 3 (Commit Inventory) failed for order {}: {}. Triggering full compensation.", orderId, e.getMessage());
            updateSagaState(sagaId, "COMPENSATING_PAYMENT", e.getMessage());

            // Compensation 1: Refund Payment
            if (paymentId != null) {
                try {
                    downstreamClient.refundPayment(paymentId, totalCents, "Inventory commit failed", "idem-saga-ref-" + orderId);
                } catch (Exception refEx) {
                    log.error("Direct refund compensation failed. Enqueuing outbox task.", refEx);
                    enqueueOutboxTask(sagaId, "REFUND_PAYMENT", Map.of("paymentId", paymentId, "amountCents", totalCents));
                }
            }

            // Compensation 2: Release Inventory
            try {
                downstreamClient.releaseInventory(orderId, "Inventory commit failed");
            } catch (Exception relEx) {
                log.error("Direct inventory release compensation failed. Enqueuing outbox task.", relEx);
                enqueueOutboxTask(sagaId, "RELEASE_INVENTORY", Map.of("orderId", orderId));
            }

            updateOrderStatus(orderId, "CANCELLED");
            updateSagaState(sagaId, "FAILED", "Inventory commit failed: " + e.getMessage());
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Inventory commit failed: " + e.getMessage(), e);
        }

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
                    "INSERT INTO order_idempotency (idempotency_key, order_id, request_hash, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?)")) {
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
    }

    private void updateSagaState(String sagaId, String state, String errorReason) {
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

    private void updateOrderStatus(String orderId, String status) {
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
