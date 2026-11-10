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

    public java.util.Optional<Map<String, Object>> getPaymentByOrderId(String orderId) {
        String url = paymentUrl + "/api/payments/order/" + orderId;
        log.info("Querying Payment Service for orderId={}", orderId);
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> resp = restClient.get()
                    .uri(url)
                    .headers(h -> h.addAll(buildTracingHeaders()))
                    .retrieve()
                    .body(Map.class);
            return java.util.Optional.ofNullable(resp);
        } catch (org.springframework.web.client.HttpClientErrorException.NotFound e) {
            return java.util.Optional.empty();
        } catch (Exception e) {
            log.warn("Failed to retrieve payment state for orderId={}: {}", orderId, e.getMessage());
            throw e;
        }
    }

    public static boolean isDefinitivePaymentDecline(Throwable t) {
        if (t == null) return false;
        if (t instanceof org.springframework.web.client.HttpClientErrorException.UnprocessableEntity) {
            return true;
        }
        if (t instanceof org.springframework.web.client.HttpStatusCodeException statusEx) {
            return statusEx.getStatusCode().value() == 422;
        }
        if (t instanceof org.springframework.web.server.ResponseStatusException rse) {
            return rse.getStatusCode().value() == 422;
        }
        String msg = t.getMessage();
        if (msg != null && (msg.contains("422") || msg.toLowerCase().contains("declined"))) {
            return true;
        }
        if (t.getCause() != null && t.getCause() != t) {
            return isDefinitivePaymentDecline(t.getCause());
        }
        return false;
    }

    public static boolean isUnknownPaymentOutcome(Throwable t) {
        if (t == null) return false;
        if (isDefinitivePaymentDecline(t)) return false;
        if (t instanceof org.springframework.web.client.HttpServerErrorException.GatewayTimeout
                || t instanceof org.springframework.web.client.HttpServerErrorException.ServiceUnavailable
                || t instanceof org.springframework.web.client.ResourceAccessException
                || t instanceof java.net.SocketTimeoutException) {
            return true;
        }
        if (t instanceof org.springframework.web.client.HttpStatusCodeException statusEx) {
            int code = statusEx.getStatusCode().value();
            return code == 504 || code == 503 || code == 502 || code == 500;
        }
        if (t instanceof org.springframework.web.server.ResponseStatusException rse) {
            int code = rse.getStatusCode().value();
            return code == 504 || code == 503 || code == 502 || code == 500;
        }
        String msg = t.getMessage();
        if (msg != null && (msg.contains("504") || msg.contains("503") || msg.contains("Timeout") || msg.contains("timeout"))) {
            return true;
        }
        if (t.getCause() != null && t.getCause() != t) {
            return isUnknownPaymentOutcome(t.getCause());
        }
        return true;
    }
}
