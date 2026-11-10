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
import java.util.UUID;

@Component
@EnableScheduling
public class OutboxWorker {

    private static final Logger log = LoggerFactory.getLogger(OutboxWorker.class);

    private final DataSource dataSource;
    private final DownstreamServiceClient downstreamClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String workerId = "worker-" + UUID.randomUUID().toString().substring(0, 8);

    public OutboxWorker(DataSource dataSource, DownstreamServiceClient downstreamClient) {
        this.dataSource = dataSource;
        this.downstreamClient = downstreamClient;
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
}
