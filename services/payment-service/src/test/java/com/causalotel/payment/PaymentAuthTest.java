package com.causalotel.payment;

import com.causalotel.payment.security.TokenService;
import com.causalotel.payment.service.PaymentGatewaySimulator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
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

import static org.junit.jupiter.api.Assertions.*;

/**
 * H-01/H-02 regression tests over real HTTP so the security filter chain is
 * exercised end to end. Fault injection must be admin-only and bounded.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PaymentAuthTest {

    @LocalServerPort
    private int port;

    @Autowired
    private TokenService tokenService;

    @Autowired
    private PaymentGatewaySimulator gatewaySimulator;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper mapper = new ObjectMapper();

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        TestDatabaseSupport.register(registry, "payment-auth.db");
    }

    @BeforeEach
    void reset() {
        gatewaySimulator.reset();
    }

    @Test
    @DisplayName("H-02: anonymous payment reads are rejected with 401")
    void anonymousReadsAreRejected() throws Exception {
        assertEquals(401, get("/api/payments", null).statusCode());
        assertEquals(401, get("/api/payments/fault", null).statusCode());
    }

    @Test
    @DisplayName("H-02: a regular user cannot read payments")
    void userCannotReadPayments() throws Exception {
        assertEquals(403, get("/api/payments", userToken()).statusCode());
    }

    @Test
    @DisplayName("H-01: fault configuration requires admin")
    void faultConfigurationRequiresAdmin() throws Exception {
        String body = "{\"latencyMs\":0,\"faultMode\":\"NORMAL\"}";
        assertEquals(401, post("/api/payments/fault", null, body).statusCode());
        assertEquals(403, post("/api/payments/fault", userToken(), body).statusCode());
        assertEquals(200, post("/api/payments/fault", adminToken(), body).statusCode());
    }

    @Test
    @DisplayName("H-01: fault latency is capped at 10000 ms and rejected input does not mutate state")
    void faultLatencyIsCapped() throws Exception {
        HttpResponse<String> response = post("/api/payments/fault", adminToken(),
                "{\"latencyMs\":10001,\"faultMode\":\"LATENCY\"}");
        assertEquals(400, response.statusCode());
        assertEquals(0, gatewaySimulator.getLatencyMs(), "Rejected request must not change latency");
        assertEquals(PaymentGatewaySimulator.FaultMode.NORMAL, gatewaySimulator.getFaultMode());
    }

    @Test
    @DisplayName("H-01: unknown fault mode is rejected without mutating state")
    void unknownFaultModeIsRejected() throws Exception {
        HttpResponse<String> response = post("/api/payments/fault", adminToken(),
                "{\"latencyMs\":250,\"faultMode\":\"NOT_A_MODE\"}");
        assertEquals(400, response.statusCode());
        assertEquals(0, gatewaySimulator.getLatencyMs(), "Rejected request must not change latency");
        assertEquals(PaymentGatewaySimulator.FaultMode.NORMAL, gatewaySimulator.getFaultMode());
    }

    @Test
    @DisplayName("H-01: overlong fault error messages are rejected")
    void overlongErrorMessageIsRejected() throws Exception {
        String message = "x".repeat(501);
        HttpResponse<String> response = post("/api/payments/fault", adminToken(),
                "{\"faultMode\":\"DECLINED\",\"errorMessage\":\"" + message + "\"}");
        assertEquals(400, response.statusCode());
    }

    @Test
    @DisplayName("H-01: accepted fault configuration is applied")
    void acceptedFaultConfigurationIsApplied() throws Exception {
        HttpResponse<String> response = post("/api/payments/fault", adminToken(),
                "{\"latencyMs\":250,\"faultMode\":\"DECLINED\",\"errorMessage\":\"card blocked\"}");
        assertEquals(200, response.statusCode());
        JsonNode body = mapper.readTree(response.body());
        assertEquals(250, body.get("latencyMs").asInt());
        assertEquals("DECLINED", body.get("faultMode").asText());
        assertEquals("card blocked", body.get("customErrorMessage").asText());
    }

    @Test
    @DisplayName("H-01: restart reset clears any previously injected fault")
    void restartResetClearsFaultState() {
        gatewaySimulator.setLatencyMs(5000);
        gatewaySimulator.setFaultMode(PaymentGatewaySimulator.FaultMode.DECLINED);
        gatewaySimulator.setCustomErrorMessage("stuck fault");

        gatewaySimulator.resetOnStartup();

        assertEquals(0, gatewaySimulator.getLatencyMs());
        assertEquals(PaymentGatewaySimulator.FaultMode.NORMAL, gatewaySimulator.getFaultMode());
        assertNull(gatewaySimulator.getCustomErrorMessage());
    }

    @Test
    @DisplayName("H-02: a regular user cannot issue refunds")
    void userCannotRefund() throws Exception {
        HttpResponse<String> response = post("/api/payments/refund", userToken(),
                "{\"paymentId\":\"pay-missing\",\"amountCents\":100,\"reason\":\"test\"}");
        assertEquals(403, response.statusCode());
    }

    @Test
    @DisplayName("H-02: service credentials can charge a payment")
    void serviceTokenCanCharge() throws Exception {
        String body = """
                {"orderId":"ord-auth-%s","amountCents":1234,"currency":"USD",
                 "idempotencyKey":"idem-auth-%s"}
                """.formatted(UUID.randomUUID(), UUID.randomUUID());
        HttpResponse<String> response = post("/api/payments/charge", serviceToken(), body);
        assertEquals(200, response.statusCode());
        JsonNode parsed = mapper.readTree(response.body());
        assertEquals("CAPTURED", parsed.get("status").asText());
    }

    private String userToken() {
        return tokenService.issue(UUID.randomUUID().toString(), "user", "ROLE_USER", 600);
    }

    private String adminToken() {
        return tokenService.issue("admin-id", "admin", "ROLE_ADMIN", 600);
    }

    private String serviceToken() {
        return tokenService.issueServiceToken();
    }

    private HttpResponse<String> get(String path, String token) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .GET();
        if (token != null) {
            builder.header("Authorization", "Bearer " + token);
        }
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String path, String token, String body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        if (token != null) {
            builder.header("Authorization", "Bearer " + token);
        }
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }
}
