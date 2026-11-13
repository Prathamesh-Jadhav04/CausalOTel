package com.causalotel.payment;

import com.causalotel.payment.security.TokenService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * L-02: with simulation disabled (the default outside demo/test profiles), the
 * payment service must refuse to charge or refund rather than silently
 * simulating a financial transaction.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "causalotel.payment.simulation.enabled=false"
)
class PaymentSimulationDisabledTest {

    @LocalServerPort
    private int port;

    @Autowired
    private TokenService tokenService;

    private final HttpClient http = HttpClient.newHttpClient();

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        TestDatabaseSupport.register(registry, "payment-simulation-disabled.db");
    }

    @Test
    @DisplayName("L-02: charge and refund fail with 503 when simulation is disabled")
    void chargeAndRefundAreRefusedWhenSimulationIsDisabled() throws Exception {
        String chargeBody = """
                {"orderId":"ord-disabled-%s","amountCents":1234,"currency":"USD",
                 "idempotencyKey":"idem-disabled-%s"}
                """.formatted(UUID.randomUUID(), UUID.randomUUID());
        assertEquals(503, post("/api/payments/charge", chargeBody).statusCode());

        String refundBody = """
                {"paymentId":"pay-missing","amountCents":100,"reason":"test",
                 "idempotencyKey":"idem-refund-disabled-%s"}
                """.formatted(UUID.randomUUID());
        assertEquals(503, post("/api/payments/refund", refundBody).statusCode());
    }

    private HttpResponse<String> post(String path, String body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + tokenService.issueServiceToken())
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
