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

import static org.junit.jupiter.api.Assertions.assertEquals;

/** H-01: an operator can disable fault injection entirely. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "causalotel.fault-injection.enabled=false")
class PaymentFaultDisabledTest {

    @LocalServerPort
    private int port;

    @Autowired
    private TokenService tokenService;

    private final HttpClient http = HttpClient.newHttpClient();

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        TestDatabaseSupport.register(registry, "payment-fault-disabled.db");
    }

    @Test
    @DisplayName("H-01: disabled fault injection returns 404 even for admins")
    void faultEndpointsAreDisabled() throws Exception {
        String admin = tokenService.issue("admin-id", "admin", "ROLE_ADMIN", 600);
        assertEquals(404, post(admin).statusCode());
        assertEquals(404, get(admin).statusCode());
    }

    private HttpResponse<String> post(String token) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/api/payments/fault"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.ofString("{\"faultMode\":\"DECLINED\"}"))
                .build();
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> get(String token) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/api/payments/fault"))
                .header("Authorization", "Bearer " + token)
                .GET()
                .build();
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
