package com.causalotel.order.service;

import com.causalotel.order.client.DownstreamServiceClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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
    /** M-03: after this many failed inventory commits a captured payment is refunded. */
    private static final int MAX_COMMIT_ATTEMPTS = 5;
    private static final long MAX_BACKOFF_MS = 60_000L;

    private final DataSource dataSource;
    private final DownstreamServiceClient downstreamClient;
    private final SagaOrchestrator sagaOrchestrator;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String workerId = "worker-" + UUID.randomUUID().toString().substring(0, 8);
    private final Counter retriedTasks;
    private final Counter deadLetteredTasks;

    /**
     * Tests disable the scheduled wrappers so retry timing can be asserted
     * deterministically; the public tick methods remain callable directly.
     */
    @Value("${causalotel.outbox.scheduling.enabled:true}")
    private boolean schedulingEnabled = true;

    public OutboxWorker(DataSource dataSource, DownstreamServiceClient downstreamClient,
                        SagaOrchestrator sagaOrchestrator, MeterRegistry meterRegistry) {
        this.dataSource = dataSource;
        this.downstreamClient = downstreamClient;
        this.sagaOrchestrator = sagaOrchestrator;
        this.retriedTasks = Counter.builder("causalotel.outbox.tasks.retried")
                .description("Outbox tasks rescheduled after a failed attempt")
                .register(meterRegistry);
        this.deadLetteredTasks = Counter.builder("causalotel.outbox.tasks.dead_lettered")
                .description("Outbox tasks that exhausted every retry and entered FAILED")
                .register(meterRegistry);
    }

    @Scheduled(fixedDelay = 5000)
    public void scheduledOutboxTick() {
        if (schedulingEnabled) {
            processOutboxTasks();
        }
    }

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
                long baseDelay = Math.min(MAX_BACKOFF_MS, (long) Math.pow(2, nextRetries) * 1000L);
                // M-01: per-task jitter avoids synchronized retry storms while keeping
                // the 2/4/8/16/32s schedule deterministic for a given task id.
                long jitterMs = Math.floorMod(taskId.hashCode(), 1000);
                long retryDelay = Math.min(MAX_BACKOFF_MS, baseDelay + jitterMs);

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
                retriedTasks.increment();
                if ("FAILED".equals(nextState)) {
                    deadLetteredTasks.increment();
                    log.error("Outbox task {} dead-lettered after {} attempts (type={}, saga={})",
                            taskId, nextRetries, taskType, sagaId);
                } else {
                    log.warn("Outbox task {} rescheduled (attempt {}/{}) in {}ms",
                            taskId, nextRetries, MAX_RETRIES, retryDelay);
                }
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
            String orderId = (String) payload.get("orderId");
            String reason = (String) payload.getOrDefault("reason", "Outbox recovery refund");
            return executeRefundPayment(orderId, sagaId, sagaOwner, reason);
        }

        if ("COMMIT_INVENTORY".equals(taskType)) {
            String orderId = (String) payload.get("orderId");
            return commitInventoryOrEscalate(orderId, sagaId, sagaOwner, null,
                    "Inventory commit failed after outbox retries");
        }

        if ("RECONCILE_PAYMENT".equals(taskType)) {
            String orderId = (String) payload.get("orderId");
            Number total = (Number) payload.get("totalCents");

            Optional<Map<String, Object>> payOpt = downstreamClient.getPaymentByOrderId(orderId);
            if (payOpt.isPresent()) {
                Map<String, Object> payRecord = payOpt.get();
                String payStatus = String.valueOf(payRecord.get("status"));
                if ("CAPTURED".equalsIgnoreCase(payStatus)) {
                    sagaOrchestrator.updateSagaState(sagaId, sagaOwner, "INVENTORY_COMMITTING", null);
                    return commitInventoryOrEscalate(orderId, sagaId, sagaOwner,
                            (String) payRecord.get("paymentId"),
                            "Inventory commit failed after payment reconciliation");
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
                    sagaOrchestrator.updateSagaState(sagaId, sagaOwner, "INVENTORY_COMMITTING", null);
                    return commitInventoryOrEscalate(orderId, sagaId, sagaOwner,
                            (String) payResp.get("paymentId"),
                            "Inventory commit failed after reconciliation charge");
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
     * M-03: commit inventory or, once attempts are exhausted, make a terminal
     * compensation decision. A final idempotent commit is attempted before the
     * refund decision: if inventory was actually committed and only the
     * response was lost, the order is confirmed instead of refunded.
     */
    private boolean commitInventoryOrEscalate(String orderId, String sagaId, String sagaOwner,
                                              String paymentId, String reason) {
        sagaOrchestrator.renewSagaLease(sagaId, sagaOwner, SAGA_LEASE_MS);
        try {
            downstreamClient.commitInventory(orderId);
        } catch (Exception commitEx) {
            int attempts = sagaOrchestrator.incrementCommitAttempts(sagaId, sagaOwner);
            log.warn("Inventory commit failed for order {} (attempt {}/{}): {}",
                    orderId, attempts, MAX_COMMIT_ATTEMPTS, commitEx.getMessage());
            if (attempts >= MAX_COMMIT_ATTEMPTS) {
                boolean resolved = compensateAfterCommitExhaustion(orderId, sagaId, sagaOwner,
                        reason + ": " + commitEx.getMessage());
                if (resolved) {
                    log.warn("Saga {} reached a terminal decision after {} commit failures",
                            sagaId, attempts);
                    return true;
                }
            }
            return false;
        }
        sagaOrchestrator.markOrderConfirmed(orderId, sagaId, sagaOwner, paymentId);
        return true;
    }

    private boolean compensateAfterCommitExhaustion(String orderId, String sagaId,
                                                    String sagaOwner, String reason) {
        sagaOrchestrator.renewSagaLease(sagaId, sagaOwner, SAGA_LEASE_MS);
        try {
            downstreamClient.commitInventory(orderId);
        } catch (Exception commitEx) {
            log.warn("Final inventory commit before refund failed for order {}: {}",
                    orderId, commitEx.getMessage());
            return sagaOrchestrator.escalateToRefund(sagaId, sagaOwner, orderId, reason);
        }
        sagaOrchestrator.markOrderConfirmed(orderId, sagaId, sagaOwner, null);
        log.info("Late inventory commit succeeded for order {}; refund not required", orderId);
        return true;
    }

    /**
     * M-03: refund a captured payment exactly once and release the abandoned
     * reservation. The payment-service idempotency key makes retries safe.
     */
    private boolean executeRefundPayment(String orderId, String sagaId, String sagaOwner,
                                         String reason) throws Exception {
        Optional<Map<String, Object>> payOpt;
        try {
            payOpt = downstreamClient.getPaymentByOrderId(orderId);
        } catch (Exception lookupEx) {
            log.warn("Could not read payment record for order {} during compensation: {}",
                    orderId, lookupEx.getMessage());
            return false;
        }

        if (payOpt.isEmpty()) {
            log.warn("No payment record for order {}; compensation will retry", orderId);
            return false;
        }

        Map<String, Object> payRecord = payOpt.get();
        String paymentId = (String) payRecord.get("paymentId");
        Number amount = (Number) payRecord.get("amountCents");
        if (paymentId == null || amount == null) {
            log.warn("Payment record for order {} lacks paymentId/amountCents; compensation will retry",
                    orderId);
            return false;
        }

        sagaOrchestrator.renewSagaLease(sagaId, sagaOwner, SAGA_LEASE_MS);
        downstreamClient.refundPayment(paymentId, amount.intValue(), reason,
                "outbox-ref-" + paymentId);
        sagaOrchestrator.markOrderRefunded(orderId, sagaId, sagaOwner, reason);

        try {
            downstreamClient.releaseInventory(orderId, reason);
        } catch (Exception releaseEx) {
            log.warn("Inventory release after refund failed for order {}; reservation will expire: {}",
                    orderId, releaseEx.getMessage());
        }
        log.info("Refunded payment {} for order {} after inventory commit exhaustion",
                paymentId, orderId);
        return true;
    }

    /**
     * H-07: recover only sagas whose lease has expired, and claim each one
     * atomically before touching downstream state. An active checkout renews
     * its lease at every step, so it can never be "recovered" concurrently.
     */
    @Scheduled(fixedDelay = 5000)
    public void scheduledRecoveryTick() {
        if (schedulingEnabled) {
            recoverStaleSagas();
        }
    }

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
                            commitInventoryOrEscalate(orderId, sagaId, owner, paymentId,
                                    "Inventory commit failed during stale-saga recovery");
                            log.info("Stale saga {} recovered or escalated", sagaId);
                        } else if ("RECONCILIATION_REQUIRED".equals(state)) {
                            Optional<Map<String, Object>> payOpt =
                                    downstreamClient.getPaymentByOrderId(orderId);
                            if (payOpt.isPresent()) {
                                Map<String, Object> payRecord = payOpt.get();
                                String payStatus = String.valueOf(payRecord.get("status"));
                                if ("CAPTURED".equalsIgnoreCase(payStatus)) {
                                    sagaOrchestrator.updateSagaState(sagaId, owner,
                                            "INVENTORY_COMMITTING", null);
                                    commitInventoryOrEscalate(orderId, sagaId, owner,
                                            (String) payRecord.get("paymentId"),
                                            "Inventory commit failed during stale reconciliation");
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
                            if (sagaOrchestrator.hasLiveRefundTask(sagaId)) {
                                // The outbox owns the compensation; do not race it.
                                sagaOrchestrator.releaseSagaLease(sagaId, owner);
                            } else {
                                executeRefundPayment(orderId, sagaId, owner,
                                        "Stale saga payment compensation");
                            }
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
