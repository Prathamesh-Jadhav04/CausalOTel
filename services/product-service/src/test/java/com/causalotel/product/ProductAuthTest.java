package com.causalotel.product;

import com.causalotel.product.security.TokenService;
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

/** H-02 regression tests over real HTTP. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ProductAuthTest {

    @LocalServerPort
    private int port;

    @Autowired
    private TokenService tokenService;

    private final HttpClient http = HttpClient.newHttpClient();

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        TestDatabaseSupport.register(registry, "product-auth.db");
    }

    @Test
    @DisplayName("H-02: anonymous catalog reads are rejected with 401")
    void anonymousCatalogReadsAreRejected() throws Exception {
        assertEquals(401, get("/api/products", null).statusCode());
        assertEquals(401, get("/api/products/SKU-LAPTOP-001", null).statusCode());
    }

    @Test
    @DisplayName("H-02: user and service tokens may read the catalog")
    void authenticatedCatalogReadsSucceed() throws Exception {
        String userToken = tokenService.issue("user-id", "user", "ROLE_USER", 600);
        assertEquals(200, get("/api/products", userToken).statusCode());
        assertEquals(200, get("/api/products", tokenService.issueServiceToken()).statusCode());
        assertEquals(404, get("/api/products/SKU-MISSING", userToken).statusCode());
    }

    @Test
    @DisplayName("H-02: forged tokens are rejected with 401")
    void forgedTokensAreRejected() throws Exception {
        assertEquals(401, get("/api/products", "v1.forged.signature").statusCode());
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
}
