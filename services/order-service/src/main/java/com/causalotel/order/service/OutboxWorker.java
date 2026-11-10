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

    private final DataSource dataSource;
    private final DownstreamServiceClient downstreamClient;
    private final SagaOrchestrator sagaOrchestrator;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String workerId = "worker-" + UUID.randomUUID().toString().substring(0, 8);

    public OutboxWorker(DataSource dataSource, DownstreamServiceClient downstreamClient, SagaOrchestrator sagaOrchestrator) {
        this.dataSource = dataSource;
        this.downstreamClient = downstreamClient;
        this.sagaOrchestrator = sagaOrchestrator;
    }

    @Scheduled(fixedDelay = 5000)
    public void processOutboxTasks() {
        long now = System.currentTimeMillis();
        long leaseDurationMs = 30000; // 30 second lease

        try (Connection conn = dataSource.getConnection()) {
            // Find one claimable task
            String taskId = null;
            String taskType = null;
            String payloadJson = null;
            int retries = 0;
            int fencingToken = 0;

            try (PreparedStatement ps = conn.prepareStatement(
                    "SELECT id, task_type, payload, retries, fencing_token FROM outbox_tasks " +
                    "WHERE state = 'PENDING' OR (state = 'IN_PROGRESS' AND lease_expires_at < ?) " +
                    "ORDER BY created_at ASC LIMIT 1")) {
                ps.setLong(1, now);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        taskId = rs.getString("id");
                        taskType = rs.getString("task_type");
                        payloadJson = rs.getString("payload");
                        retries = rs.getInt("retries");
                        fencingToken = rs.getInt("fencing_token");
                    }
                }
            }

            if (taskId == null) {
                return; // Nothing to process
            }

            // Atomic claim with fencing token increment
            int claimed;
            int newFencingToken = fencingToken + 1;
            long leaseExpiresAt = now + leaseDurationMs;

            try (PreparedStatement ps = conn.prepareStatement(
                    "UPDATE outbox_tasks SET state = 'IN_PROGRESS', worker_id = ?, lease_expires_at = ?, fencing_token = ?, updated_at = ? " +
                    "WHERE id = ? AND fencing_token = ?")) {
                ps.setString(1, workerId);
                ps.setLong(2, leaseExpiresAt);
                ps.setInt(3, newFencingToken);
                ps.setLong(4, now);
                ps.setString(5, taskId);
                ps.setInt(6, fencingToken);
                claimed = ps.executeUpdate();
            }

            if (claimed == 0) {
                // Lost race to another worker
                return;
            }

            log.info("Claimed outbox task {} ({}) with token {}", taskId, taskType, newFencingToken);

            // Execute task
            boolean success = false;
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> payload = objectMapper.readValue(payloadJson, Map.class);

                if ("RELEASE_INVENTORY".equals(taskType)) {
                    String orderId = (String) payload.get("orderId");
                    String reason = (String) payload.getOrDefault("reason", "Outbox recovery release");
                    downstreamClient.releaseInventory(orderId, reason);
                    success = true;
                } else if ("REFUND_PAYMENT".equals(taskType)) {
                    String paymentId = (String) payload.get("paymentId");
                    int amountCents = (Integer) payload.get("amountCents");
                    String idemKey = "outbox-ref-" + taskId;
                    downstreamClient.refundPayment(paymentId, amountCents, "Outbox recovery refund", idemKey);
                    success = true;
                } else if ("COMMIT_INVENTORY".equals(taskType)) {
                    String orderId = (String) payload.get("orderId");
                    String sagaId = (String) payload.get("sagaId");
                    downstreamClient.commitInventory(orderId);
                    if (sagaId != null) {
                        sagaOrchestrator.updateSagaState(sagaId, "COMPLETED", null);
                    }
                    sagaOrchestrator.updateOrderStatus(orderId, "CONFIRMED");
                    success = true;
                } else if ("RECONCILE_PAYMENT".equals(taskType)) {
                    String orderId = (String) payload.get("orderId");
                    String sagaId = (String) payload.get("sagaId");
                    Optional<Map<String, Object>> payOpt = downstreamClient.getPaymentByOrderId(orderId);
                    if (payOpt.isPresent()) {
                        Map<String, Object> payRecord = payOpt.get();
                        if ("CAPTURED".equalsIgnoreCase((String) payRecord.get("status"))) {
                            // Payment captured: commit inventory and confirm order
                            downstreamClient.commitInventory(orderId);
                            if (sagaId != null) {
                                sagaOrchestrator.updateSagaState(sagaId, "COMPLETED", null);
                            }
                            sagaOrchestrator.updateOrderStatus(orderId, "CONFIRMED");
                            log.info("Reconciled outbox task {}: payment confirmed, order {} CONFIRMED", taskId, orderId);
                            success = true;
                        } else if ("DECLINED".equalsIgnoreCase((String) payRecord.get("status")) || "FAILED".equalsIgnoreCase((String) payRecord.get("status"))) {
                            // Payment definitively declined: release inventory and cancel order
                            downstreamClient.releaseInventory(orderId, "Outbox reconciliation: payment was not captured");
                            if (sagaId != null) {
                                sagaOrchestrator.updateSagaState(sagaId, "FAILED", "Payment declined upon reconciliation");
                            }
                            sagaOrchestrator.updateOrderStatus(orderId, "CANCELLED");
                            log.info("Reconciled outbox task {}: payment declined, order {} CANCELLED", taskId, orderId);
                            success = true;
                        } else {
                            log.warn("Payment reconciliation for order {} still unresolved, will retry", orderId);
                            success = false;
                        }
                    } else {
                        log.warn("Payment reconciliation for order {} not found yet, will retry", orderId);
                        success = false;
                    }
                }
            } catch (Exception ex) {
                log.error("Outbox task {} execution failed: {}", taskId, ex.getMessage());
            }

            // Mark completion or schedule backoff
            long finishTime = System.currentTimeMillis();
            if (success) {
                try (PreparedStatement ps = conn.prepareStatement(
                        "UPDATE outbox_tasks SET state = 'COMPLETED', updated_at = ? WHERE id = ? AND fencing_token = ?")) {
                    ps.setLong(1, finishTime);
                    ps.setString(2, taskId);
                    ps.setInt(3, newFencingToken);
                    ps.executeUpdate();
                }
                log.info("Outbox task {} completed successfully", taskId);
            } else {
                int nextRetries = retries + 1;
                String nextState = nextRetries >= 5 ? "FAILED" : "PENDING";
                long retryDelay = (long) Math.min(60000, Math.pow(2, nextRetries) * 1000);
                long nextLease = finishTime + retryDelay;

                try (PreparedStatement ps = conn.prepareStatement(
                        "UPDATE outbox_tasks SET state = ?, retries = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND fencing_token = ?")) {
                    ps.setString(1, nextState);
                    ps.setInt(2, nextRetries);
                    ps.setLong(3, nextLease);
                    ps.setLong(4, finishTime);
                    ps.setString(5, taskId);
                    ps.setInt(6, newFencingToken);
                    ps.executeUpdate();
                }
                log.warn("Outbox task {} rescheduled (attempt {}/5)", taskId, nextRetries);
            }
        } catch (Exception e) {
            log.error("Error in outbox processing cycle", e);
        }
    }

    @Scheduled(fixedDelay = 5000)
    public void recoverStaleSagas() {
        long staleThreshold = System.currentTimeMillis() - 5000;
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT id, order_id, current_state FROM saga_instances " +
                     "WHERE current_state IN ('PAYMENT_CONFIRMED', 'INVENTORY_COMMITTING', 'RECONCILIATION_REQUIRED', 'COMPENSATING_INVENTORY', 'COMPENSATING_PAYMENT') " +
                     "AND updated_at < ? LIMIT 10")) {
            ps.setLong(1, staleThreshold);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String sagaId = rs.getString("id");
                    String orderId = rs.getString("order_id");
                    String state = rs.getString("current_state");
                    log.info("Recovering stale saga {} for order {} in state {}", sagaId, orderId, state);

                    try {
                        if ("PAYMENT_CONFIRMED".equals(state) || "INVENTORY_COMMITTING".equals(state)) {
                            downstreamClient.commitInventory(orderId);
                            sagaOrchestrator.updateSagaState(sagaId, "COMPLETED", null);
                            sagaOrchestrator.updateOrderStatus(orderId, "CONFIRMED");
                            log.info("Stale saga {} successfully recovered to COMPLETED and order CONFIRMED", sagaId);
                        } else if ("RECONCILIATION_REQUIRED".equals(state)) {
                            Optional<Map<String, Object>> payOpt = downstreamClient.getPaymentByOrderId(orderId);
                            if (payOpt.isPresent()) {
                                Map<String, Object> payRecord = payOpt.get();
                                if ("CAPTURED".equalsIgnoreCase((String) payRecord.get("status"))) {
                                    downstreamClient.commitInventory(orderId);
                                    sagaOrchestrator.updateSagaState(sagaId, "COMPLETED", null);
                                    sagaOrchestrator.updateOrderStatus(orderId, "CONFIRMED");
                                    log.info("Stale saga {} reconciled: payment was captured, order CONFIRMED", sagaId);
                                } else if ("DECLINED".equalsIgnoreCase((String) payRecord.get("status")) || "FAILED".equalsIgnoreCase((String) payRecord.get("status"))) {
                                    downstreamClient.releaseInventory(orderId, "Stale saga reconciliation: payment was not captured");
                                    sagaOrchestrator.updateSagaState(sagaId, "FAILED", "Payment was not captured");
                                    sagaOrchestrator.updateOrderStatus(orderId, "CANCELLED");
                                    log.info("Stale saga {} reconciled: payment declined, order CANCELLED", sagaId);
                                }
                            }
                        } else if ("COMPENSATING_INVENTORY".equals(state)) {
                            downstreamClient.releaseInventory(orderId, "Stale saga recovery release");
                            sagaOrchestrator.updateSagaState(sagaId, "FAILED", "Compensation completed");
                            sagaOrchestrator.updateOrderStatus(orderId, "CANCELLED");
                        }
                    } catch (Exception ex) {
                        log.warn("Recovery attempt for saga {} failed (will retry): {}", sagaId, ex.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error in recoverStaleSagas cycle", e);
        }
    }
}
