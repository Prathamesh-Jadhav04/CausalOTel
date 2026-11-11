package com.causalotel.order.service;

import com.causalotel.order.client.DownstreamServiceClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Component
@EnableScheduling
public class OutboxWorker {

    private static final Logger log = LoggerFactory.getLogger(OutboxWorker.class);

    private static final long TASK_LEASE_MS = 30_000L;
    private static final long SAGA_LEASE_MS = 30_000L;
    private static final int MAX_RETRIES = 5;
    private static final long MAX_BACKOFF_MS = 60_000L;

    private final DataSource dataSource;
    private final DownstreamServiceClient downstreamClient;
    private final SagaOrchestrator sagaOrchestrator;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String workerId = "worker-" + UUID.randomUUID().toString().substring(0, 8);

    public OutboxWorker(DataSource dataSource, DownstreamServiceClient downstreamClient,
                        SagaOrchestrator sagaOrchestrator) {
        this.dataSource = dataSource;
        this.downstreamClient = downstreamClient;
        this.sagaOrchestrator = sagaOrchestrator;
    }

    @Scheduled(fixedDelay = 5000)
    public void processOutboxTasks() {
        long now = System.currentTimeMillis();

        try (Connection conn = dataSource.getConnection()) {
            String taskId = null;
            String taskType = null;
            String payloadJson = null;
            String sagaId = null;
            int retries = 0;
            int fencingToken = 0;

            try (PreparedStatement ps = conn.prepareStatement(
                    "SELECT id, task_type, payload, saga_id, retries, fencing_token FROM outbox_tasks " +
                            "WHERE (state = 'PENDING' AND next_attempt_at <= ?) " +
                            "   OR (state = 'IN_PROGRESS' AND lease_expires_at < ?) " +
                            "ORDER BY created_at ASC LIMIT 1")) {
                ps.setLong(1, now);
                ps.setLong(2, now);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        taskId = rs.getString("id");
                        taskType = rs.getString("task_type");
                        payloadJson = rs.getString("payload");
                        sagaId = rs.getString("saga_id");
                        retries = rs.getInt("retries");
                        fencingToken = rs.getInt("fencing_token");
                    }
                }
            }

            if (taskId == null) {
                return;
            }

            int newFencingToken = fencingToken + 1;
            long leaseExpiresAt = now + TASK_LEASE_MS;

            int claimed;
            try (PreparedStatement ps = conn.prepareStatement(
                    "UPDATE outbox_tasks SET state = 'IN_PROGRESS', worker_id = ?, lease_expires_at = ?, " +
                            "fencing_token = ?, updated_at = ? WHERE id = ? AND fencing_token = ? AND (" +
                            "(state = 'PENDING' AND next_attempt_at <= ?) OR " +
                            "(state = 'IN_PROGRESS' AND lease_expires_at < ?))")) {
                ps.setString(1, workerId);
                ps.setLong(2, leaseExpiresAt);
                ps.setInt(3, newFencingToken);
                ps.setLong(4, now);
                ps.setString(5, taskId);
                ps.setInt(6, fencingToken);
                ps.setLong(7, now);
                ps.setLong(8, now);
                claimed = ps.executeUpdate();
            }

            if (claimed == 0) {
                return; // Lost the race to another worker.
            }

            log.info("Claimed outbox task {} ({}) with token {}", taskId, taskType, newFencingToken);

            boolean success = false;
            String sagaOwner = null;
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> payload = objectMapper.readValue(payloadJson, Map.class);

                if (sagaId != null) {
                    sagaOwner = "outbox-" + workerId + "-" + UUID.randomUUID();
                    if (!sagaOrchestrator.claimSagaLease(sagaId, sagaOwner, SAGA_LEASE_MS)) {
                        log.info("Saga {} is owned by another worker; rescheduling task {}", sagaId, taskId);
                        success = false;
                    } else {
                        success = executeTask(taskType, payload, sagaId, sagaOwner);
                    }
                } else {
                    success = executeTask(taskType, payload, null, null);
                }
            } catch (Exception ex) {
                log.error("Outbox task {} execution failed: {}", taskId, ex.getMessage());
                success = false;
            }

            long finishTime = System.currentTimeMillis();
            if (success) {
                try (PreparedStatement ps = conn.prepareStatement(
                        "UPDATE outbox_tasks SET state = 'COMPLETED', lease_expires_at = 0, updated_at = ? " +
                                "WHERE id = ? AND fencing_token = ?")) {
                    ps.setLong(1, finishTime);
                    ps.setString(2, taskId);
                    ps.setInt(3, newFencingToken);
                    ps.executeUpdate();
                }
                log.info("Outbox task {} completed successfully", taskId);
            } else {
                int nextRetries = retries + 1;
                String nextState = nextRetries >= MAX_RETRIES ? "FAILED" : "PENDING";
                long retryDelay = Math.min(MAX_BACKOFF_MS, (long) Math.pow(2, nextRetries) * 1000L);

                try (PreparedStatement ps = conn.prepareStatement(
                        "UPDATE outbox_tasks SET state = ?, retries = ?, lease_expires_at = 0, " +
                                "next_attempt_at = ?, updated_at = ? WHERE id = ? AND fencing_token = ?")) {
                    ps.setString(1, nextState);
                    ps.setInt(2, nextRetries);
                    ps.setLong(3, finishTime + retryDelay);
                    ps.setLong(4, finishTime);
                    ps.setString(5, taskId);
                    ps.setInt(6, newFencingToken);
                    ps.executeUpdate();
                }
                log.warn("Outbox task {} rescheduled (attempt {}/{})", taskId, nextRetries, MAX_RETRIES);
            }
        } catch (Exception e) {
            log.error("Error in outbox processing cycle", e);
        }
    }

    private boolean executeTask(String taskType, Map<String, Object> payload,
                                String sagaId, String sagaOwner) throws Exception {
        if ("RELEASE_INVENTORY".equals(taskType)) {
            String orderId = (String) payload.get("orderId");
            String status = sagaOrchestrator.getOrderStatus(orderId);
            if ("CONFIRMED".equalsIgnoreCase(status)) {
                log.warn("Skipping inventory release for CONFIRMED order {}", orderId);
                return true;
            }
            if ("CANCELLED".equalsIgnoreCase(status)) {
                return true;
            }
            String reason = (String) payload.getOrDefault("reason", "Outbox recovery release");
            downstreamClient.releaseInventory(orderId, reason);
            sagaOrchestrator.markOrderCancelled(orderId, sagaId, sagaOwner,
                    "Inventory released after payment failure", 422);
            return true;
        }

        if ("REFUND_PAYMENT".equals(taskType)) {
            String paymentId = (String) payload.get("paymentId");
            Number amount = (Number) payload.get("amountCents");
            String idemKey = "outbox-ref-" + paymentId;
            downstreamClient.refundPayment(paymentId, amount == null ? 0 : amount.intValue(),
                    "Outbox recovery refund", idemKey);
            String orderId = (String) payload.get("orderId");
            if (orderId != null) {
                sagaOrchestrator.markOrderCancelled(orderId, sagaId, sagaOwner,
                        "Payment refunded during compensation", 422);
            }
            return true;
        }

        if ("COMMIT_INVENTORY".equals(taskType)) {
            String orderId = (String) payload.get("orderId");
            sagaOrchestrator.renewSagaLease(sagaId, sagaOwner, SAGA_LEASE_MS);
            downstreamClient.commitInventory(orderId);
            sagaOrchestrator.markOrderConfirmed(orderId, sagaId, sagaOwner, null);
            return true;
        }

        if ("RECONCILE_PAYMENT".equals(taskType)) {
            String orderId = (String) payload.get("orderId");
            Number total = (Number) payload.get("totalCents");

            Optional<Map<String, Object>> payOpt = downstreamClient.getPaymentByOrderId(orderId);
            if (payOpt.isPresent()) {
                Map<String, Object> payRecord = payOpt.get();
                String payStatus = String.valueOf(payRecord.get("status"));
                if ("CAPTURED".equalsIgnoreCase(payStatus)) {
                    sagaOrchestrator.renewSagaLease(sagaId, sagaOwner, SAGA_LEASE_MS);
                    downstreamClient.commitInventory(orderId);
                    sagaOrchestrator.markOrderConfirmed(orderId, sagaId, sagaOwner,
                            (String) payRecord.get("paymentId"));
                    return true;
                }
                if ("DECLINED".equalsIgnoreCase(payStatus) || "FAILED".equalsIgnoreCase(payStatus)) {
                    downstreamClient.releaseInventory(orderId,
                            "Outbox reconciliation: payment was not captured");
                    sagaOrchestrator.markOrderCancelled(orderId, sagaId, sagaOwner,
                            "Payment declined upon reconciliation", 422);
                    return true;
                }
                log.warn("Payment reconciliation for order {} still unresolved, will retry", orderId);
                return false;
            }

            if (total == null || total.longValue() <= 0) {
                downstreamClient.releaseInventory(orderId, "Payment record not found and cannot be charged");
                sagaOrchestrator.markOrderCancelled(orderId, sagaId, sagaOwner,
                        "Payment not found and cannot be charged", 422);
                return true;
            }

            try {
                sagaOrchestrator.renewSagaLease(sagaId, sagaOwner, SAGA_LEASE_MS);
                Map<String, Object> payResp = downstreamClient.chargePayment(
                        orderId, total.intValue(), "USD", "pay-" + orderId);
                if ("CAPTURED".equalsIgnoreCase((String) payResp.get("status"))) {
                    downstreamClient.commitInventory(orderId);
                    sagaOrchestrator.markOrderConfirmed(orderId, sagaId, sagaOwner,
                            (String) payResp.get("paymentId"));
                    return true;
                }
                return false;
            } catch (Exception ex) {
                if (DownstreamServiceClient.isDefinitivePaymentDecline(ex)) {
                    downstreamClient.releaseInventory(orderId, "Payment declined on retry: " + ex.getMessage());
                    sagaOrchestrator.markOrderCancelled(orderId, sagaId, sagaOwner,
                            "Payment declined: " + ex.getMessage(), 422);
                    return true;
                }
                log.warn("Reconcile charge retry failed for order {}: {}", orderId, ex.getMessage());
                return false;
            }
        }

        log.error("Unknown outbox task type: {}", taskType);
        return false;
    }

    /**
     * H-07: recover only sagas whose lease has expired, and claim each one
     * atomically before touching downstream state. An active checkout renews
     * its lease at every step, so it can never be "recovered" concurrently.
     */
    @Scheduled(fixedDelay = 5000)
    public void recoverStaleSagas() {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT id, order_id, current_state FROM saga_instances " +
                             "WHERE current_state IN ('PAYMENT_CONFIRMED', 'INVENTORY_COMMITTING', " +
                             "'RECONCILIATION_REQUIRED', 'COMPENSATING_INVENTORY', 'COMPENSATING_PAYMENT') " +
                             "AND lease_expires_at < ? LIMIT 10")) {
            ps.setLong(1, now);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String sagaId = rs.getString("id");
                    String orderId = rs.getString("order_id");

                    String owner = "recovery-" + workerId + "-" + UUID.randomUUID();
                    if (!sagaOrchestrator.claimSagaLease(sagaId, owner, SAGA_LEASE_MS)) {
                        continue; // Another worker claimed it first.
                    }

                    // Re-read after claiming: the state may have changed between
                    // the SELECT and the atomic claim.
                    String state = sagaOrchestrator.getSagaState(sagaId);
                    log.info("Recovering stale saga {} for order {} in state {}", sagaId, orderId, state);

                    try {
                        if ("PAYMENT_CONFIRMED".equals(state) || "INVENTORY_COMMITTING".equals(state)) {
                            String paymentId = null;
                            try {
                                Optional<Map<String, Object>> payOpt =
                                        downstreamClient.getPaymentByOrderId(orderId);
                                if (payOpt.isPresent()) {
                                    paymentId = (String) payOpt.get().get("paymentId");
                                }
                            } catch (Exception ignored) {
                                // The commit is still safe; paymentId is informational.
                            }
                            sagaOrchestrator.renewSagaLease(sagaId, owner, SAGA_LEASE_MS);
                            downstreamClient.commitInventory(orderId);
                            sagaOrchestrator.markOrderConfirmed(orderId, sagaId, owner, paymentId);
                            log.info("Stale saga {} recovered to COMPLETED", sagaId);
                        } else if ("RECONCILIATION_REQUIRED".equals(state)) {
                            Optional<Map<String, Object>> payOpt =
                                    downstreamClient.getPaymentByOrderId(orderId);
                            if (payOpt.isPresent()) {
                                Map<String, Object> payRecord = payOpt.get();
                                String payStatus = String.valueOf(payRecord.get("status"));
                                if ("CAPTURED".equalsIgnoreCase(payStatus)) {
                                    sagaOrchestrator.renewSagaLease(sagaId, owner, SAGA_LEASE_MS);
                                    downstreamClient.commitInventory(orderId);
                                    sagaOrchestrator.markOrderConfirmed(orderId, sagaId, owner,
                                            (String) payRecord.get("paymentId"));
                                } else if ("DECLINED".equalsIgnoreCase(payStatus)
                                        || "FAILED".equalsIgnoreCase(payStatus)) {
                                    downstreamClient.releaseInventory(orderId,
                                            "Stale saga reconciliation: payment was not captured");
                                    sagaOrchestrator.markOrderCancelled(orderId, sagaId, owner,
                                            "Payment was not captured", 422);
                                } else {
                                    sagaOrchestrator.releaseSagaLease(sagaId, owner);
                                }
                            } else {
                                sagaOrchestrator.releaseSagaLease(sagaId, owner);
                            }
                        } else if ("COMPENSATING_INVENTORY".equals(state)) {
                            downstreamClient.releaseInventory(orderId, "Stale saga recovery release");
                            sagaOrchestrator.markOrderCancelled(orderId, sagaId, owner,
                                    "Compensation completed", 422);
                        } else if ("COMPENSATING_PAYMENT".equals(state)) {
                            Optional<Map<String, Object>> payOpt =
                                    downstreamClient.getPaymentByOrderId(orderId);
                            if (payOpt.isPresent()) {
                                String paymentId = (String) payOpt.get().get("paymentId");
                                Number amount = (Number) payOpt.get().get("amountCents");
                                downstreamClient.refundPayment(paymentId,
                                        amount == null ? 0 : amount.intValue(),
                                        "Stale saga compensation refund",
                                        "outbox-ref-" + paymentId);
                            }
                            downstreamClient.releaseInventory(orderId, "Stale saga payment compensation");
                            sagaOrchestrator.markOrderCancelled(orderId, sagaId, owner,
                                    "Payment compensation completed", 422);
                        } else {
                            sagaOrchestrator.releaseSagaLease(sagaId, owner);
                        }
                    } catch (Exception ex) {
                        log.warn("Recovery attempt for saga {} failed (will retry after lease expiry): {}",
                                sagaId, ex.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error in recoverStaleSagas cycle", e);
        }
    }
}
