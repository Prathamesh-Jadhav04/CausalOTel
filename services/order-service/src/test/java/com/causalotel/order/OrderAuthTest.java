package com.causalotel.order;

import com.causalotel.order.client.DownstreamServiceClient;
import com.causalotel.order.security.TokenService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import javax.sql.DataSource;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;

/**
 * H-02 regression tests over real HTTP so the Spring Security filter chain is
 * exercised end to end. The order database is isolated per run.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OrderAuthTest {

    @TestConfiguration
    static class TestConfig {
        @Bean
        @Primary
        public DownstreamServiceClient mockDownstreamServiceClient() {
            return Mockito.mock(DownstreamServiceClient.class);
        }
    }

    @LocalServerPort
    private int port;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private TokenService tokenService;

    @Autowired
    private DownstreamServiceClient downstreamServiceClient;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper mapper = new ObjectMapper();

    private String userA;
    private String userB;
    private String orderA;
    private String orderB;

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        TestDatabaseSupport.register(registry, "order-auth.db");
    }

    @BeforeEach
    void setup() throws Exception {
        TestDatabaseSupport.assertIsolated(dataSource);
        Mockito.reset(downstreamServiceClient);
        when(downstreamServiceClient.getProductBySku(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(java.util.Optional.of(java.util.Map.of(
                        "id", "PROD-001", "sku", "SKU-001", "price_cents", 5000, "stock_quantity", 100)));

        userA = UUID.randomUUID().toString();
        userB = UUID.randomUUID().toString();
        orderA = "ord-auth-a-" + UUID.randomUUID().toString().substring(0, 8);
        orderB = "ord-auth-b-" + UUID.randomUUID().toString().substring(0, 8);
        insertOrder(orderA, userA);
        insertOrder(orderB, userB);
    }

    @Test
    @DisplayName("M-09: liveness and metrics endpoints stay public for orchestration")
    void healthEndpointsArePublic() throws Exception {
        assertEquals(200, get("/health/live", null).statusCode());
        assertEquals(200, get("/health/ready", null).statusCode());
        assertEquals(200, get("/actuator/health", null).statusCode());
    }

    @Test
    @DisplayName("H-02: anonymous order API requests are rejected with 401")
    void anonymousRequestsAreRejected() throws Exception {
        assertEquals(401, get("/api/orders", null).statusCode());
        assertEquals(401, get("/api/orders/" + orderA, null).statusCode());
        assertEquals(401, get("/api/orders/outbox", null).statusCode());
    }

    @Test
    @DisplayName("H-02: a user only sees their own orders")
    void userSeesOnlyOwnOrders() throws Exception {
        HttpResponse<String> response = get("/api/orders", userToken(userA));
        assertEquals(200, response.statusCode());
        JsonNode body = mapper.readTree(response.body());
        assertEquals(1, body.size(), "Only the caller's order may be returned");
        assertEquals(orderA, body.get(0).get("order_id").asText());
        assertEquals(userA, body.get(0).get("user_id").asText());
    }

    @Test
    @DisplayName("H-02: user A cannot read user B's order or items")
    void crossUserReadIsHidden() throws Exception {
        assertEquals(404, get("/api/orders/" + orderB, userToken(userA)).statusCode());
        assertEquals(404, get("/api/orders/" + orderB + "/items", userToken(userA)).statusCode());
        assertEquals(404, get("/api/orders/" + orderB + "/saga", userToken(userA)).statusCode());
    }

    @Test
    @DisplayName("H-02: outbox requires admin, not a regular user")
    void outboxRequiresAdmin() throws Exception {
        assertEquals(403, get("/api/orders/outbox", userToken(userA)).statusCode());
        assertEquals(200, get("/api/orders/outbox", adminToken()).statusCode());
    }

    @Test
    @DisplayName("H-02: checkout cannot specify another user's id")
    void checkoutCannotImpersonateAnotherUser() throws Exception {
        String body = """
                {"userId":"%s","items":[{"productId":"PROD-1","sku":"SKU-001","quantity":1}],
                 "idempotencyKey":"idem-%s","currency":"USD"}
                """.formatted(userB, UUID.randomUUID());
        HttpResponse<String> response = post("/api/orders/checkout", userToken(userA), body);
        assertEquals(403, response.statusCode());
        Mockito.verifyNoInteractions(downstreamServiceClient);
    }

    @Test
    @DisplayName("H-02: invalid/forged tokens are rejected with 401")
    void forgedTokenIsRejected() throws Exception {
        assertEquals(401, get("/api/orders", "v1.not-a-token.signature").statusCode());
        String valid = userToken(userA);
        assertEquals(401, get("/api/orders", valid.substring(0, valid.length() - 2) + "xx").statusCode());
    }

    @Test
    @DisplayName("H-02: service credentials are accepted for reconciliation")
    void serviceTokenCanReconcile() throws Exception {
        HttpResponse<String> response = post("/api/orders/missing-order/reconcile",
                tokenService.issueServiceToken(), "");
        assertEquals(404, response.statusCode(),
                "Authorization must pass; the missing order is the only failure");
    }

    private String userToken(String userId) {
        return tokenService.issue(userId, "user-" + userId.substring(0, 4), "ROLE_USER", 600);
    }

    private String adminToken() {
        return tokenService.issue("admin-id", "admin", "ROLE_ADMIN", 600);
    }

    private void insertOrder(String orderId, String userId) throws Exception {
        long now = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "INSERT INTO orders (order_id, user_id, status, total_cents, created_at, updated_at) " +
                             "VALUES (?, ?, 'CONFIRMED', 5000, ?, ?)")) {
            ps.setString(1, orderId);
            ps.setString(2, userId);
            ps.setLong(3, now);
            ps.setLong(4, now);
            ps.executeUpdate();
        }
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
