package com.causalotel.order.client;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;

@Service
public class DownstreamServiceClient {

    private static final Logger log = LoggerFactory.getLogger(DownstreamServiceClient.class);

    private final RestClient restClient;
    private final String inventoryUrl;
    private final String paymentUrl;

    public DownstreamServiceClient(
            @Value("${services.inventory.url:http://localhost:5050}") String inventoryUrl,
            @Value("${services.payment.url:http://localhost:8084}") String paymentUrl) {
        this.inventoryUrl = inventoryUrl;
        this.paymentUrl = paymentUrl;
        this.restClient = RestClient.builder().build();
    }

    private HttpHeaders buildTracingHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        try {
            SpanContext spanContext = Span.current().getSpanContext();
            if (spanContext.isValid()) {
                String traceparent = String.format("00-%s-%s-%s",
                        spanContext.getTraceId(),
                        spanContext.getSpanId(),
                        spanContext.getTraceFlags().asHex()
                );
                headers.set("traceparent", traceparent);
                log.debug("Propagating W3C traceparent: {}", traceparent);
            }
        } catch (Throwable t) {
            log.warn("Failed to extract active span for trace propagation: {}", t.getMessage());
        }
        return headers;
    }

    public Map<String, Object> reserveInventory(String orderId, List<Map<String, Object>> items) {
        String url = inventoryUrl + "/api/inventory/reserve";
        Map<String, Object> body = Map.of(
                "orderId", orderId,
                "items", items
        );
        log.info("Calling Inventory Service reserve for orderId={}", orderId);
        return restClient.post()
                .uri(url)
                .headers(h -> h.addAll(buildTracingHeaders()))
                .body(body)
                .retrieve()
                .body(Map.class);
    }

    public Map<String, Object> commitInventory(String orderId) {
        String url = inventoryUrl + "/api/inventory/commit";
        Map<String, Object> body = Map.of("orderId", orderId);
        log.info("Calling Inventory Service commit for orderId={}", orderId);
        return restClient.post()
                .uri(url)
                .headers(h -> h.addAll(buildTracingHeaders()))
                .body(body)
                .retrieve()
                .body(Map.class);
    }

    public Map<String, Object> releaseInventory(String orderId, String reason) {
        String url = inventoryUrl + "/api/inventory/release";
        Map<String, Object> body = Map.of(
                "orderId", orderId,
                "reason", reason != null ? reason : "Saga Compensation"
        );
        log.info("Calling Inventory Service release for orderId={}", orderId);
        return restClient.post()
                .uri(url)
                .headers(h -> h.addAll(buildTracingHeaders()))
                .body(body)
                .retrieve()
                .body(Map.class);
    }

    public Map<String, Object> chargePayment(String orderId, int amountCents, String currency, String idempotencyKey) {
        String url = paymentUrl + "/api/payments/charge";
        Map<String, Object> body = Map.of(
                "orderId", orderId,
                "amountCents", amountCents,
                "currency", currency,
                "idempotencyKey", idempotencyKey
        );
        log.info("Calling Payment Service charge for orderId={}, amountCents={}", orderId, amountCents);
        return restClient.post()
                .uri(url)
                .headers(h -> h.addAll(buildTracingHeaders()))
                .body(body)
                .retrieve()
                .body(Map.class);
    }

    public Map<String, Object> refundPayment(String paymentId, int amountCents, String reason, String idempotencyKey) {
        String url = paymentUrl + "/api/payments/refund";
        Map<String, Object> body = Map.of(
                "paymentId", paymentId,
                "amountCents", amountCents,
                "reason", reason != null ? reason : "Saga compensation refund",
                "idempotencyKey", idempotencyKey
        );
        log.info("Calling Payment Service refund for paymentId={}, amountCents={}", paymentId, amountCents);
        return restClient.post()
                .uri(url)
                .headers(h -> h.addAll(buildTracingHeaders()))
                .body(body)
                .retrieve()
                .body(Map.class);
    }
}
