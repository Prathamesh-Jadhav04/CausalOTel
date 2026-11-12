package com.causalotel.order.service;

import com.causalotel.order.client.DownstreamServiceClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;
import java.util.regex.Pattern;

@Service
public class SagaOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(SagaOrchestrator.class);

    private static final int MAX_ITEMS = 50;
    private static final int MAX_QUANTITY_PER_ITEM = 1000;
    private static final long MAX_TOTAL_CENTS = 100_000_000L;
    private static final long SAGA_LEASE_MS = 30_000L;
    private static final String ENDPOINT_VERSION = "checkout-v1";
    private static final Pattern IDEMPOTENCY_KEY_PATTERN = Pattern.compile("^[A-Za-z0-9._:-]{1,128}$");
    private static final Pattern SKU_PATTERN = Pattern.compile("^[A-Za-z0-9._-]{1,64}$");
    private static final Pattern CURRENCY_PATTERN = Pattern.compile("^[A-Z]{3}$");

    private final DataSource dataSource;
    private final DownstreamServiceClient downstreamClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String instanceId = "order-" + UUID.randomUUID();

    public SagaOrchestrator(DataSource dataSource, DownstreamServiceClient downstreamClient) {
        this.dataSource = dataSource;
        this.downstreamClient = downstreamClient;
    }

    public record OrderItemDto(String productId, String sku, int quantity, Integer expectedPriceCents) {
        public OrderItemDto(String productId, String sku, int quantity) {
            this(productId, sku, quantity, null);
        }
    }

    public record CheckoutRequest(String userId, List<OrderItemDto> items, String idempotencyKey, String currency) {
        public CheckoutRequest(String userId, List<OrderItemDto> items, String idempotencyKey) {
            this(userId, items, idempotencyKey, "USD");
        }
    }

    private record ResolvedItem(String productId, String sku, int quantity, int unitPriceCents) {}

    private record Claim(String orderId, String sagaId) {}

    private record ExistingClaim(String userId, String orderId, String requestHash, String state,
                                 int responseStatus, String responseBody) {}

    // ---------------------------------------------------------------------
    // Checkout
    // ---------------------------------------------------------------------

    public Map<String, Object> checkout(CheckoutRequest request) throws Exception {
        if (request == null || request.items() == null || request.items().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Checkout items cannot be empty");
        }
        if (request.items().size() > MAX_ITEMS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Too many checkout items");
        }
        if (request.userId() == null || request.userId().isBlank() || request.userId().length() > 64) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A valid userId is required");
        }

        String idempotencyKey = normalizeIdempotencyKey(request.idempotencyKey());
        String currency = normalizeCurrency(request.currency());

        // C-02: the client never supplies the price used for the order or charge.
        List<ResolvedItem> resolvedItems = resolveCatalogPrices(request.items());
        long totalLong = 0;
        for (ResolvedItem item : resolvedItems) {
            totalLong += (long) item.quantity() * item.unitPriceCents();
        }
        if (totalLong <= 0 || totalLong > MAX_TOTAL_CENTS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Order total is outside the allowed range");
        }
        int totalCents = Math.toIntExact(totalLong);

        // H-03: hash the full canonical request including server-resolved prices.
        String requestHash = canonicalHash(request.userId(), currency, resolvedItems);

        String owner = instanceId + ":" + UUID.randomUUID();
        String orderId = "ord-" + UUID.randomUUID();
        String sagaId = "saga-" + UUID.randomUUID();
        long now = System.currentTimeMillis();

        Claim claim = createClaimAndOrder(idempotencyKey, request.userId(), requestHash, orderId,
                sagaId, owner, resolvedItems, totalCents, now);

        if (claim == null) {
            long deadline = System.currentTimeMillis() + 10_000L;
            while (true) {
                ExistingClaim existing = readClaim(idempotencyKey);
                if (existing == null) {
                    throw new SagaPersistenceException(
                            "Idempotency claim disappeared while processing " + idempotencyKey);
                }
                if (existing.userId() != null && !existing.userId().isBlank()
                        && !existing.userId().equals(request.userId())) {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                            "Idempotency key belongs to a different user");
                }
                if (!requestHash.equals(existing.requestHash())) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "Idempotency key reused with different checkout parameters");
                }
                if ("COMPLETED".equals(existing.state())) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> cached = objectMapper.readValue(existing.responseBody(), Map.class);
                    return cached;
                }
                if ("FAILED".equals(existing.state())) {
                    throw new ResponseStatusException(HttpStatus.valueOf(existing.responseStatus()),
                            extractMessage(existing.responseBody()));
                }
                if (System.currentTimeMillis() >= deadline) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "A checkout with this idempotency key is already in progress");
                }
                sleepQuietly(100);
            }
        }

        orderId = claim.orderId();
        sagaId = claim.sagaId();
        String paymentId = null;

        // Step 1: Reserve inventory.
        try {
            updateSagaState(sagaId, owner, "INVENTORY_RESERVING", null);
            List<Map<String, Object>> reserveItems = new ArrayList<>();
            for (ResolvedItem item : resolvedItems) {
                reserveItems.add(Map.of("sku", item.sku(), "quantity", item.quantity()));
            }
            downstreamClient.reserveInventory(orderId, reserveItems);
            updateSagaState(sagaId, owner, "INVENTORY_RESERVED", null);
        } catch (SagaPersistenceException | SagaLeaseLostException e) {
            throw e;
        } catch (Exception e) {
            log.error("Saga Step 1 (Reserve Inventory) failed for order {}: {}", orderId, e.getMessage());
            failCheckout(sagaId, owner, orderId, idempotencyKey, "FAILED", "FAILED",
                    "Inventory reservation failed: " + e.getMessage(), 409,
                    "Unable to reserve inventory: " + e.getMessage(), null, null);
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Unable to reserve inventory: " + e.getMessage(), e);
        }

        // Step 2: Charge payment.
        try {
            updateSagaState(sagaId, owner, "PAYMENT_PROCESSING", null);
            Map<String, Object> payResp = downstreamClient.chargePayment(
                    orderId, totalCents, currency, "pay-" + orderId);
            paymentId = (String) payResp.get("paymentId");
            updateSagaState(sagaId, owner, "PAYMENT_CONFIRMED", null);
        } catch (SagaPersistenceException | SagaLeaseLostException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Saga Step 2 payment charge call threw exception for order {}: {}", orderId, e.getMessage());

            if (DownstreamServiceClient.isDefinitivePaymentDecline(e)) {
                compensateDeclinedPayment(sagaId, owner, orderId, idempotencyKey, e);
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                        "Payment processing failed: " + e.getMessage(), e);
            }

            // Unknown outcome: HTTP 504/timeouts never prove failure.
            Optional<Map<String, Object>> paymentRecordOpt = Optional.empty();
            try {
                paymentRecordOpt = downstreamClient.getPaymentByOrderId(orderId);
            } catch (Exception queryEx) {
                log.warn("Could not retrieve payment record for order {}: {}", orderId, queryEx.getMessage());
            }

            if (paymentRecordOpt.isPresent()
                    && "CAPTURED".equalsIgnoreCase((String) paymentRecordOpt.get().get("status"))) {
                paymentId = (String) paymentRecordOpt.get().get("paymentId");
                log.info("Reconciliation confirmed payment was CAPTURED for order {}. paymentId={}", orderId, paymentId);
                updateSagaState(sagaId, owner, "PAYMENT_CONFIRMED", null);
            } else {
                log.warn("Payment outcome unresolved for order {}. Entering reconciliation.", orderId);
                failCheckout(sagaId, owner, orderId, idempotencyKey,
                        "PENDING_RECONCILIATION", "RECONCILIATION_REQUIRED",
                        "Payment outcome unknown: " + e.getMessage(), 504,
                        "Payment outcome unknown. Order entered reconciliation.",
                        "RECONCILE_PAYMENT",
                        Map.of("orderId", orderId, "totalCents", totalCents, "sagaId", sagaId));
                throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT,
                        "Payment outcome unknown. Order entered reconciliation.", e);
            }
        }

        // Step 3: Commit inventory.
        boolean committed = false;
        for (int attempt = 1; attempt <= 3 && !committed; attempt++) {
            try {
                updateSagaState(sagaId, owner, "INVENTORY_COMMITTING", null);
                downstreamClient.commitInventory(orderId);
                committed = true;
            } catch (SagaPersistenceException | SagaLeaseLostException e) {
                throw e;
            } catch (Exception e) {
                log.warn("Commit inventory attempt {} failed for order {}: {}", attempt, orderId, e.getMessage());
                if (attempt < 3) {
                    sleepQuietly(50);
                }
            }
        }

        if (!committed) {
            failCheckout(sagaId, owner, orderId, idempotencyKey,
                    "PENDING", "INVENTORY_COMMITTING",
                    "Inventory commit pending", 504,
                    "Inventory commit in progress. Order will be confirmed asynchronously.",
                    "COMMIT_INVENTORY", Map.of("orderId", orderId, "sagaId", sagaId));
            throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT,
                    "Inventory commit in progress. Order will be confirmed asynchronously.");
        }

        // Step 4: Terminal writes in one transaction (H-06).
        Map<String, Object> responseMap = new HashMap<>();
        responseMap.put("orderId", orderId);
        responseMap.put("userId", request.userId());
        responseMap.put("status", "CONFIRMED");
        responseMap.put("totalCents", totalCents);
        responseMap.put("paymentId", paymentId);
        responseMap.put("sagaId", sagaId);
        responseMap.put("createdAt", now);

        finalizeConfirmed(orderId, sagaId, owner, idempotencyKey, responseMap);
        return responseMap;
    }

    private Claim createClaimAndOrder(String idempotencyKey, String userId, String requestHash,
                                      String orderId, String sagaId, String owner,
                                      List<ResolvedItem> items, int totalCents, long now) {
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO order_idempotency (idempotency_key, order_id, user_id, request_hash, " +
                                "response_status, response_body, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")) {
                    ps.setString(1, idempotencyKey);
                    ps.setString(2, orderId);
                    ps.setString(3, userId);
                    ps.setString(4, requestHash);
                    ps.setInt(5, 0);
                    ps.setString(6, "{}");
                    ps.setString(7, "IN_PROGRESS");
                    ps.setLong(8, now);
                    ps.executeUpdate();
                }

                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO orders (order_id, user_id, status, total_cents, created_at, updated_at) " +
                                "VALUES (?, ?, ?, ?, ?, ?)")) {
                    ps.setString(1, orderId);
                    ps.setString(2, userId);
                    ps.setString(3, "PENDING");
                    ps.setInt(4, totalCents);
                    ps.setLong(5, now);
                    ps.setLong(6, now);
                    ps.executeUpdate();
                }

                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO order_items (order_id, sku, quantity, price_cents) VALUES (?, ?, ?, ?)")) {
                    for (ResolvedItem item : items) {
                        ps.setString(1, orderId);
                        ps.setString(2, item.sku());
                        ps.setInt(3, item.quantity());
                        ps.setInt(4, item.unitPriceCents());
                        ps.addBatch();
                    }
                    ps.executeBatch();
                }

                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO saga_instances (id, order_id, current_state, error_reason, created_at, updated_at, " +
                                "lease_owner, lease_expires_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
                    ps.setString(1, sagaId);
                    ps.setString(2, orderId);
                    ps.setString(3, "STARTED");
                    ps.setString(4, null);
                    ps.setLong(5, now);
                    ps.setLong(6, now);
                    ps.setString(7, owner);
                    ps.setLong(8, now + SAGA_LEASE_MS);
                    ps.setInt(9, 1);
                    ps.executeUpdate();
                }

                conn.commit();
                return new Claim(orderId, sagaId);
            } catch (SQLException e) {
                conn.rollback();
                if (isIdempotencyConstraintViolation(e)) {
                    return null;
                }
                throw new SagaPersistenceException("Failed to create order/saga claim", e);
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to create order/saga claim", e);
        }
    }

    private ExistingClaim readClaim(String idempotencyKey) {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT user_id, order_id, request_hash, state, response_status, response_body " +
                             "FROM order_idempotency WHERE idempotency_key = ?")) {
            ps.setString(1, idempotencyKey);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                String userId = rs.getString("user_id");
                return new ExistingClaim(userId, rs.getString("order_id"), rs.getString("request_hash"),
                        rs.getString("state"), rs.getInt("response_status"), rs.getString("response_body"));
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to read idempotency claim", e);
        }
    }

    private void compensateDeclinedPayment(String sagaId, String owner, String orderId,
                                           String idempotencyKey, Exception cause) {
        boolean released = false;
        try {
            downstreamClient.releaseInventory(orderId, "Payment declined: " + cause.getMessage());
            released = true;
        } catch (SagaPersistenceException | SagaLeaseLostException e) {
            throw e;
        } catch (Exception releaseEx) {
            log.error("Direct inventory compensation failed for order {}. Enqueuing outbox task.", orderId, releaseEx);
        }

        if (released) {
            failCheckout(sagaId, owner, orderId, idempotencyKey, "CANCELLED", "FAILED",
                    "Payment charge declined: " + cause.getMessage(), 422,
                    "Payment processing failed: " + cause.getMessage(), null, null);
        } else {
            failCheckout(sagaId, owner, orderId, idempotencyKey, "CANCELLED", "COMPENSATING_INVENTORY",
                    "Payment declined; inventory release pending", 422,
                    "Payment processing failed: " + cause.getMessage(),
                    "RELEASE_INVENTORY",
                    Map.of("orderId", orderId, "reason", "Payment declined"));
        }
    }

    /**
     * H-06: order status, saga state, optional outbox task, and the idempotency
     * result are persisted in one transaction. Any failure aborts the checkout
     * instead of silently losing durability.
     */
    private void failCheckout(String sagaId, String owner, String orderId, String idempotencyKey,
                              String orderStatus, String sagaState, String errorReason,
                              int responseStatus, String message,
                              String outboxTaskType, Map<String, Object> outboxPayload) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                updateOrderStatus(conn, orderId, orderStatus, now);
                updateSagaState(conn, sagaId, owner, sagaState, errorReason, now);
                if (outboxTaskType != null && outboxPayload != null) {
                    enqueueOutboxTask(conn, sagaId, outboxTaskType, outboxPayload, now);
                }
                updateIdempotencyByKey(conn, idempotencyKey, "FAILED", responseStatus,
                        objectMapper.writeValueAsString(Map.of("message", message)), now);
                conn.commit();
            } catch (Exception e) {
                conn.rollback();
                if (e instanceof SagaLeaseLostException leaseLost) {
                    throw leaseLost;
                }
                throw new SagaPersistenceException("Failed to persist checkout failure state", e);
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to persist checkout failure state", e);
        }
    }

    private void finalizeConfirmed(String orderId, String sagaId, String owner,
                                   String idempotencyKey, Map<String, Object> responseMap) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                updateOrderStatus(conn, orderId, "CONFIRMED", now);
                updateSagaState(conn, sagaId, owner, "COMPLETED", null, now);
                updateIdempotencyByKey(conn, idempotencyKey, "COMPLETED", 200,
                        objectMapper.writeValueAsString(responseMap), now);
                conn.commit();
            } catch (Exception e) {
                conn.rollback();
                if (e instanceof SagaLeaseLostException leaseLost) {
                    throw leaseLost;
                }
                throw new SagaPersistenceException("Failed to persist confirmed order state", e);
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to persist confirmed order state", e);
        }
    }

    // ---------------------------------------------------------------------
    // Saga lease / state primitives (H-06, H-07)
    // ---------------------------------------------------------------------

    public boolean claimSagaLease(String sagaId, String owner, long leaseMs) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "UPDATE saga_instances SET lease_owner = ?, lease_expires_at = ?, version = version + 1, " +
                             "updated_at = ? WHERE id = ? AND (lease_owner IS NULL OR lease_expires_at < ? OR lease_owner = ?)")) {
            ps.setString(1, owner);
            ps.setLong(2, now + leaseMs);
            ps.setLong(3, now);
            ps.setString(4, sagaId);
            ps.setLong(5, now);
            ps.setString(6, owner);
            return ps.executeUpdate() == 1;
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to claim saga lease " + sagaId, e);
        }
    }

    public void renewSagaLease(String sagaId, String owner, long leaseMs) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "UPDATE saga_instances SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND lease_owner = ?")) {
            ps.setLong(1, now + leaseMs);
            ps.setLong(2, now);
            ps.setString(3, sagaId);
            ps.setString(4, owner);
            if (ps.executeUpdate() != 1) {
                throw new SagaLeaseLostException(sagaId);
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to renew saga lease " + sagaId, e);
        }
    }

    public void releaseSagaLease(String sagaId, String owner) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "UPDATE saga_instances SET lease_expires_at = 0, updated_at = ? WHERE id = ? AND lease_owner = ?")) {
            ps.setLong(1, now);
            ps.setString(2, sagaId);
            ps.setString(3, owner);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to release saga lease " + sagaId, e);
        }
    }

    public void updateSagaState(String sagaId, String owner, String state, String errorReason) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection()) {
            updateSagaState(conn, sagaId, owner, state, errorReason, now);
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to update saga state " + state, e);
        }
    }

    private void updateSagaState(Connection conn, String sagaId, String owner, String state,
                                 String errorReason, long now) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE saga_instances SET current_state = ?, error_reason = ?, updated_at = ?, " +
                        "lease_expires_at = ?, version = version + 1 WHERE id = ? AND lease_owner = ?")) {
            ps.setString(1, state);
            ps.setString(2, errorReason);
            ps.setLong(3, now);
            ps.setLong(4, now + SAGA_LEASE_MS);
            ps.setString(5, sagaId);
            ps.setString(6, owner);
            if (ps.executeUpdate() != 1) {
                throw new SagaLeaseLostException(sagaId);
            }
        }
    }

    public void updateOrderStatus(String orderId, String status) {
        try (Connection conn = dataSource.getConnection()) {
            updateOrderStatus(conn, orderId, status, System.currentTimeMillis());
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to update order status " + status, e);
        }
    }

    private void updateOrderStatus(Connection conn, String orderId, String status, long now) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ?")) {
            ps.setString(1, status);
            ps.setLong(2, now);
            ps.setString(3, orderId);
            if (ps.executeUpdate() != 1) {
                throw new SQLException("Order not found while updating status: " + orderId);
            }
        }
    }

    public void enqueueOutboxTask(String sagaId, String taskType, Map<String, Object> payload) {
        try (Connection conn = dataSource.getConnection()) {
            enqueueOutboxTask(conn, sagaId, taskType, payload, System.currentTimeMillis());
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to enqueue outbox task " + taskType, e);
        }
    }

    private void enqueueOutboxTask(Connection conn, String sagaId, String taskType,
                                   Map<String, Object> payload, long now) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT INTO outbox_tasks (id, saga_id, task_type, payload, state, lease_expires_at, " +
                        "fencing_token, retries, next_attempt_at, created_at, updated_at) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
            ps.setString(1, UUID.randomUUID().toString());
            ps.setString(2, sagaId);
            ps.setString(3, taskType);
            ps.setString(4, objectMapper.writeValueAsString(payload));
            ps.setString(5, "PENDING");
            ps.setLong(6, 0);
            ps.setInt(7, 0);
            ps.setInt(8, 0);
            ps.setLong(9, 0);
            ps.setLong(10, now);
            ps.setLong(11, now);
            ps.executeUpdate();
            log.info("Enqueued outbox task {} for saga {}", taskType, sagaId);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new SQLException("Failed to serialize outbox payload", e);
        }
    }

    private void updateIdempotencyByKey(Connection conn, String idempotencyKey, String state,
                                        int responseStatus, String responseBody, long now) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE order_idempotency SET state = ?, response_status = ?, response_body = ?, created_at = created_at " +
                        "WHERE idempotency_key = ?")) {
            ps.setString(1, state);
            ps.setInt(2, responseStatus);
            ps.setString(3, responseBody);
            ps.setString(4, idempotencyKey);
            if (ps.executeUpdate() != 1) {
                throw new SQLException("Idempotency claim not found: " + idempotencyKey);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Terminal transitions used by the outbox worker and recovery
    // ---------------------------------------------------------------------

    public void markOrderConfirmed(String orderId, String sagaId, String owner, String paymentId) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                updateOrderStatus(conn, orderId, "CONFIRMED", now);
                if (sagaId != null) {
                    updateSagaState(conn, sagaId, owner, "COMPLETED", null, now);
                }
                Map<String, Object> response = readOrderResponse(conn, orderId, paymentId, sagaId);
                completeIdempotencyForOrder(conn, orderId, 200, objectMapper.writeValueAsString(response), now);
                conn.commit();
            } catch (Exception e) {
                conn.rollback();
                if (e instanceof SagaLeaseLostException leaseLost) {
                    throw leaseLost;
                }
                throw new SagaPersistenceException("Failed to confirm order " + orderId, e);
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to confirm order " + orderId, e);
        }
    }

    public void markOrderCancelled(String orderId, String sagaId, String owner,
                                   String reason, int responseStatus) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                updateOrderStatus(conn, orderId, "CANCELLED", now);
                if (sagaId != null) {
                    updateSagaState(conn, sagaId, owner, "FAILED", reason, now);
                }
                completeIdempotencyForOrder(conn, orderId, responseStatus,
                        objectMapper.writeValueAsString(Map.of("message", reason)), now);
                conn.commit();
            } catch (Exception e) {
                conn.rollback();
                if (e instanceof SagaLeaseLostException leaseLost) {
                    throw leaseLost;
                }
                throw new SagaPersistenceException("Failed to cancel order " + orderId, e);
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to cancel order " + orderId, e);
        }
    }

    /**
     * M-03: terminal state for a captured payment that was compensated because
     * inventory could never be committed. The order is REFUNDED, not CANCELLED,
     * so operators can distinguish "nothing was charged" from "money returned".
     */
    public void markOrderRefunded(String orderId, String sagaId, String owner, String reason) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                updateOrderStatus(conn, orderId, "REFUNDED", now);
                if (sagaId != null) {
                    updateSagaState(conn, sagaId, owner, "REFUNDED", reason, now);
                }
                Map<String, Object> response = new LinkedHashMap<>();
                response.put("orderId", orderId);
                response.put("status", "REFUNDED");
                response.put("message", reason);
                completeIdempotencyForOrder(conn, orderId, 200,
                        objectMapper.writeValueAsString(response), now);
                conn.commit();
            } catch (Exception e) {
                conn.rollback();
                if (e instanceof SagaLeaseLostException leaseLost) {
                    throw leaseLost;
                }
                throw new SagaPersistenceException("Failed to mark order refunded " + orderId, e);
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to mark order refunded " + orderId, e);
        }
    }

    private void completeIdempotencyForOrder(Connection conn, String orderId, int responseStatus,
                                             String responseBody, long now) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE order_idempotency SET state = 'COMPLETED', response_status = ?, response_body = ? " +
                        "WHERE order_id = ?")) {
            ps.setInt(1, responseStatus);
            ps.setString(2, responseBody);
            ps.setString(3, orderId);
            ps.executeUpdate();
        }
    }

    private Map<String, Object> readOrderResponse(Connection conn, String orderId,
                                                  String paymentId, String sagaId) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT user_id, status, total_cents, created_at FROM orders WHERE order_id = ?")) {
            ps.setString(1, orderId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    throw new SQLException("Order not found: " + orderId);
                }
                Map<String, Object> response = new HashMap<>();
                response.put("orderId", orderId);
                response.put("userId", rs.getString("user_id"));
                response.put("status", "CONFIRMED");
                response.put("totalCents", rs.getInt("total_cents"));
                response.put("paymentId", paymentId);
                response.put("sagaId", sagaId);
                response.put("createdAt", rs.getLong("created_at"));
                return response;
            }
        }
    }

    public String getOrderStatus(String orderId) {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT status FROM orders WHERE order_id = ?")) {
            ps.setString(1, orderId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString("status") : null;
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to read order status " + orderId, e);
        }
    }

    public String getSagaState(String sagaId) {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT current_state FROM saga_instances WHERE id = ?")) {
            ps.setString(1, sagaId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString("current_state") : null;
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to read saga state " + sagaId, e);
        }
    }

    public int getCommitAttempts(String sagaId) {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT commit_attempts FROM saga_instances WHERE id = ?")) {
            ps.setString(1, sagaId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to read commit attempts " + sagaId, e);
        }
    }

    public int incrementCommitAttempts(String sagaId, String owner) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                try (PreparedStatement ps = conn.prepareStatement(
                        "UPDATE saga_instances SET commit_attempts = commit_attempts + 1, updated_at = ? " +
                                "WHERE id = ? AND lease_owner = ?")) {
                    ps.setLong(1, now);
                    ps.setString(2, sagaId);
                    ps.setString(3, owner);
                    if (ps.executeUpdate() != 1) {
                        conn.rollback();
                        throw new SagaLeaseLostException(sagaId);
                    }
                }
                int attempts;
                try (PreparedStatement ps = conn.prepareStatement(
                        "SELECT commit_attempts FROM saga_instances WHERE id = ?")) {
                    ps.setString(1, sagaId);
                    try (ResultSet rs = ps.executeQuery()) {
                        attempts = rs.next() ? rs.getInt(1) : 0;
                    }
                }
                conn.commit();
                return attempts;
            } catch (Exception e) {
                conn.rollback();
                if (e instanceof SagaLeaseLostException leaseLost) {
                    throw leaseLost;
                }
                throw new SagaPersistenceException("Failed to increment commit attempts " + sagaId, e);
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to increment commit attempts " + sagaId, e);
        }
    }

    /**
     * M-03: terminal compensation decision for a captured payment whose
     * inventory can never be committed. The state guard makes the transition
     * and the single REFUND_PAYMENT outbox task exactly-once even when several
     * workers race. Returns true when the saga is already compensating or
     * refunded, so callers can treat the decision as idempotent.
     */
    public boolean escalateToRefund(String sagaId, String owner, String orderId, String reason) {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                int updated;
                try (PreparedStatement ps = conn.prepareStatement(
                        "UPDATE saga_instances SET current_state = 'COMPENSATING_PAYMENT', error_reason = ?, " +
                                "updated_at = ?, lease_expires_at = 0, version = version + 1 " +
                                "WHERE id = ? AND lease_owner = ? " +
                                "AND current_state IN ('PAYMENT_CONFIRMED', 'INVENTORY_COMMITTING')")) {
                    ps.setString(1, reason);
                    ps.setLong(2, now);
                    ps.setString(3, sagaId);
                    ps.setString(4, owner);
                    updated = ps.executeUpdate();
                }

                if (updated != 1) {
                    String state = null;
                    try (PreparedStatement ps = conn.prepareStatement(
                            "SELECT current_state FROM saga_instances WHERE id = ?")) {
                        ps.setString(1, sagaId);
                        try (ResultSet rs = ps.executeQuery()) {
                            if (rs.next()) {
                                state = rs.getString(1);
                            }
                        }
                    }
                    conn.rollback();
                    return "COMPENSATING_PAYMENT".equals(state) || "REFUNDED".equals(state);
                }

                updateOrderStatus(conn, orderId, "REFUNDING", now);
                if (!hasOutboxTask(conn, sagaId, "REFUND_PAYMENT")) {
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("orderId", orderId);
                    payload.put("sagaId", sagaId);
                    payload.put("reason", reason);
                    enqueueOutboxTask(conn, sagaId, "REFUND_PAYMENT", payload, now);
                }
                conn.commit();
                log.warn("Escalated saga {} for order {} to COMPENSATING_PAYMENT: {}", sagaId, orderId, reason);
                return true;
            } catch (Exception e) {
                conn.rollback();
                if (e instanceof SagaLeaseLostException leaseLost) {
                    throw leaseLost;
                }
                throw new SagaPersistenceException("Failed to escalate saga " + sagaId + " to refund", e);
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to escalate saga " + sagaId + " to refund", e);
        }
    }

    private boolean hasOutboxTask(Connection conn, String sagaId, String taskType) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT 1 FROM outbox_tasks WHERE saga_id = ? AND task_type = ? LIMIT 1")) {
            ps.setString(1, sagaId);
            ps.setString(2, taskType);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    /**
     * True while the outbox still owns a refund attempt. Recovery must not run
     * a second refund in parallel with a live REFUND_PAYMENT task.
     */
    public boolean hasLiveRefundTask(String sagaId) {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT 1 FROM outbox_tasks WHERE saga_id = ? AND task_type = 'REFUND_PAYMENT' " +
                             "AND state IN ('PENDING', 'IN_PROGRESS') LIMIT 1")) {
            ps.setString(1, sagaId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to read refund task state for saga " + sagaId, e);
        }
    }

    // ---------------------------------------------------------------------
    // Reconciliation
    // ---------------------------------------------------------------------

    public Map<String, Object> reconcileOrder(String orderId) throws Exception {
        int totalCents;
        String currentOrderStatus;
        String sagaId = null;

        try (Connection conn = dataSource.getConnection()) {
            try (PreparedStatement ps = conn.prepareStatement(
                    "SELECT status, total_cents FROM orders WHERE order_id = ?")) {
                ps.setString(1, orderId);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) {
                        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Order not found: " + orderId);
                    }
                    currentOrderStatus = rs.getString("status");
                    totalCents = rs.getInt("total_cents");
                }
            }
            try (PreparedStatement ps = conn.prepareStatement(
                    "SELECT id FROM saga_instances WHERE order_id = ?")) {
                ps.setString(1, orderId);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        sagaId = rs.getString("id");
                    }
                }
            }
        } catch (SQLException e) {
            throw new SagaPersistenceException("Failed to read order for reconciliation", e);
        }

        if ("CONFIRMED".equalsIgnoreCase(currentOrderStatus)) {
            return Map.of("orderId", orderId, "status", "CONFIRMED", "message", "Order already confirmed");
        }
        if (sagaId == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Order has no saga instance");
        }

        String owner = "reconcile-" + UUID.randomUUID();
        if (!claimSagaLease(sagaId, owner, SAGA_LEASE_MS)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Order reconciliation is already in progress");
        }

        try {
            Optional<Map<String, Object>> paymentRecordOpt = downstreamClient.getPaymentByOrderId(orderId);
            if (paymentRecordOpt.isPresent()
                    && "CAPTURED".equalsIgnoreCase((String) paymentRecordOpt.get().get("status"))) {
                String paymentId = (String) paymentRecordOpt.get().get("paymentId");
                renewSagaLease(sagaId, owner, SAGA_LEASE_MS);
                downstreamClient.commitInventory(orderId);
                markOrderConfirmed(orderId, sagaId, owner, paymentId);
                return Map.of("orderId", orderId, "status", "CONFIRMED",
                        "message", "Payment was confirmed CAPTURED; inventory committed");
            }

            try {
                renewSagaLease(sagaId, owner, SAGA_LEASE_MS);
                Map<String, Object> payResp = downstreamClient.chargePayment(
                        orderId, totalCents, "USD", "pay-" + orderId);
                if ("CAPTURED".equalsIgnoreCase((String) payResp.get("status"))) {
                    downstreamClient.commitInventory(orderId);
                    markOrderConfirmed(orderId, sagaId, owner, (String) payResp.get("paymentId"));
                    return Map.of("orderId", orderId, "status", "CONFIRMED",
                            "message", "Payment charged successfully upon reconciliation; inventory committed");
                }
            } catch (Exception e) {
                if (DownstreamServiceClient.isDefinitivePaymentDecline(e)) {
                    downstreamClient.releaseInventory(orderId, "Payment declined: " + e.getMessage());
                    markOrderCancelled(orderId, sagaId, owner, "Payment declined: " + e.getMessage(), 422);
                    return Map.of("orderId", orderId, "status", "CANCELLED",
                            "message", "Payment declined upon reconciliation: " + e.getMessage());
                }
                throw e;
            }

            releaseSagaLease(sagaId, owner);
            return Map.of("orderId", orderId, "status", currentOrderStatus,
                    "message", "Reconciliation still indeterminate");
        } catch (SagaLeaseLostException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Saga ownership was taken over by recovery", e);
        }
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private List<ResolvedItem> resolveCatalogPrices(List<OrderItemDto> items) {
        Map<String, ResolvedItem> merged = new TreeMap<>();
        for (OrderItemDto item : items) {
            if (item == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Checkout item cannot be null");
            }
            String sku = item.sku();
            if (sku == null || !SKU_PATTERN.matcher(sku).matches()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid SKU: " + sku);
            }
            if (item.quantity() <= 0 || item.quantity() > MAX_QUANTITY_PER_ITEM) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Quantity must be between 1 and " + MAX_QUANTITY_PER_ITEM + " for SKU " + sku);
            }

            Map<String, Object> product;
            try {
                product = downstreamClient.getProductBySku(sku)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                                "Unknown or unpurchasable SKU: " + sku));
            } catch (ResourceAccessException e) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                        "Product catalog is unavailable", e);
            }

            Object priceValue = product.get("price_cents");
            Object stockValue = product.get("stock_quantity");
            if (!(priceValue instanceof Number) || !(stockValue instanceof Number)) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "Product catalog returned an invalid record for SKU: " + sku);
            }
            int catalogPrice = ((Number) priceValue).intValue();
            int stockQuantity = ((Number) stockValue).intValue();
            if (catalogPrice <= 0) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Catalog price is not chargeable for SKU: " + sku);
            }
            if (stockQuantity <= 0) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "SKU is out of stock: " + sku);
            }
            if (item.expectedPriceCents() != null && item.expectedPriceCents() != catalogPrice) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Catalog price changed for SKU " + sku + ": expected "
                                + item.expectedPriceCents() + " but catalog is " + catalogPrice);
            }

            String productId = item.productId() != null
                    ? item.productId()
                    : String.valueOf(product.getOrDefault("id", ""));
            ResolvedItem existing = merged.get(sku);
            if (existing == null) {
                merged.put(sku, new ResolvedItem(productId, sku, item.quantity(), catalogPrice));
            } else {
                if (existing.unitPriceCents() != catalogPrice) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "Conflicting catalog prices for SKU: " + sku);
                }
                int combinedQuantity = existing.quantity() + item.quantity();
                if (combinedQuantity > MAX_QUANTITY_PER_ITEM) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "Combined quantity exceeds the limit for SKU: " + sku);
                }
                merged.put(sku, new ResolvedItem(existing.productId(), sku, combinedQuantity, catalogPrice));
            }
        }
        return new ArrayList<>(merged.values());
    }

    private String canonicalHash(String userId, String currency, List<ResolvedItem> items) {
        StringBuilder canonical = new StringBuilder();
        canonical.append(ENDPOINT_VERSION)
                .append("|user=").append(userId)
                .append("|currency=").append(currency)
                .append("|items=");
        boolean first = true;
        for (ResolvedItem item : items) {
            if (!first) {
                canonical.append(',');
            }
            first = false;
            canonical.append(item.sku()).append(':')
                    .append(item.quantity()).append(':')
                    .append(item.unitPriceCents());
        }
        return sha256(canonical.toString());
    }

    private String normalizeIdempotencyKey(String key) {
        if (key == null || key.isBlank()) {
            return "idem-" + UUID.randomUUID();
        }
        String trimmed = key.trim();
        if (!IDEMPOTENCY_KEY_PATTERN.matcher(trimmed).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "idempotencyKey must be 1-128 characters of letters, digits, dot, underscore, colon, or hyphen");
        }
        return trimmed;
    }

    private String normalizeCurrency(String currency) {
        if (currency == null || currency.isBlank()) {
            return "USD";
        }
        String normalized = currency.trim().toUpperCase(Locale.ROOT);
        if (!CURRENCY_PATTERN.matcher(normalized).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid currency code");
        }
        return normalized;
    }

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
            throw new IllegalStateException("SHA-256 algorithm unavailable", e);
        }
    }

    private String extractMessage(String responseBody) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> body = objectMapper.readValue(responseBody, Map.class);
            Object message = body.get("message");
            return message != null ? String.valueOf(message) : "Checkout failed";
        } catch (Exception e) {
            return "Checkout failed";
        }
    }

    private static boolean isIdempotencyConstraintViolation(SQLException e) {
        String message = e.getMessage();
        return message != null && message.contains("order_idempotency");
    }

    private static void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public static class SagaPersistenceException extends RuntimeException {
        public SagaPersistenceException(String message) {
            super(message);
        }

        public SagaPersistenceException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public static class SagaLeaseLostException extends RuntimeException {
        public SagaLeaseLostException(String sagaId) {
            super("Saga lease was lost or taken over: " + sagaId);
        }
    }
}
