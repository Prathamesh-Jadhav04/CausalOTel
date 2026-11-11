package com.causalotel.user;

import com.causalotel.user.security.TokenService;
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

import javax.sql.DataSource;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** H-02/M-04 regression tests over real HTTP. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class UserAuthApiTest {

    @LocalServerPort
    private int port;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private TokenService tokenService;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper mapper = new ObjectMapper();

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        TestDatabaseSupport.register(registry, "user-auth.db");
    }

    @BeforeEach
    void cleanup() throws Exception {
        TestDatabaseSupport.assertIsolated(dataSource);
        try (Connection conn = dataSource.getConnection()) {
            conn.createStatement().execute("DELETE FROM users;");
        }
    }

    @Test
    @DisplayName("H-02: register issues a user token and persists a UUID identity")
    void registerIssuesTokenAndPersistsUuid() throws Exception {
        String username = "user" + UUID.randomUUID().toString().substring(0, 8);
        HttpResponse<String> response = post("/api/auth/register", null,
                "{\"username\":\"" + username + "\",\"email\":\"" + username + "@example.com\"," +
                        "\"password\":\"StrongP@ss123\"}");
        assertEquals(201, response.statusCode());
        JsonNode body = mapper.readTree(response.body());
        assertFalse(body.get("token").asText().isBlank());
        assertEquals("Bearer", body.get("tokenType").asText());
        assertEquals("ROLE_USER", body.get("user").get("role").asText());
        UUID.fromString(body.get("user").get("id").asText());
    }

    @Test
    @DisplayName("H-02: duplicate registration is rejected with 409")
    void duplicateRegistrationIsRejected() throws Exception {
        String username = "dup" + UUID.randomUUID().toString().substring(0, 8);
        String payload = "{\"username\":\"" + username + "\",\"email\":\"" + username + "@example.com\"," +
                "\"password\":\"StrongP@ss123\"}";
        assertEquals(201, post("/api/auth/register", null, payload).statusCode());
        assertEquals(409, post("/api/auth/register", null, payload).statusCode());
    }

    @Test
    @DisplayName("H-02: login succeeds with username or email and rejects bad passwords")
    void loginSucceedsAndRejectsBadPassword() throws Exception {
        String username = "login" + UUID.randomUUID().toString().substring(0, 8);
        String email = username + "@example.com";
        assertEquals(201, post("/api/auth/register", null,
                "{\"username\":\"" + username + "\",\"email\":\"" + email + "\"," +
                        "\"password\":\"StrongP@ss123\"}").statusCode());

        HttpResponse<String> byUsername = post("/api/auth/login", null,
                "{\"usernameOrEmail\":\"" + username + "\",\"password\":\"StrongP@ss123\"}");
        assertEquals(200, byUsername.statusCode());
        assertFalse(mapper.readTree(byUsername.body()).get("token").asText().isBlank());

        HttpResponse<String> byEmail = post("/api/auth/login", null,
                "{\"usernameOrEmail\":\"" + email + "\",\"password\":\"StrongP@ss123\"}");
        assertEquals(200, byEmail.statusCode());

        assertEquals(401, post("/api/auth/login", null,
                "{\"usernameOrEmail\":\"" + username + "\",\"password\":\"WrongP@ss123\"}").statusCode());
        assertEquals(401, post("/api/auth/login", null,
                "{\"usernameOrEmail\":\"nobody-" + UUID.randomUUID() + "\",\"password\":\"StrongP@ss123\"}")
                .statusCode());
    }

    @Test
    @DisplayName("H-02: /api/auth/me returns the authenticated user and rejects anonymous access")
    void meReturnsAuthenticatedUser() throws Exception {
        String username = "me" + UUID.randomUUID().toString().substring(0, 8);
        HttpResponse<String> registration = post("/api/auth/register", null,
                "{\"username\":\"" + username + "\",\"email\":\"" + username + "@example.com\"," +
                        "\"password\":\"StrongP@ss123\"}");
        String token = mapper.readTree(registration.body()).get("token").asText();
        String userId = mapper.readTree(registration.body()).get("user").get("id").asText();

        assertEquals(401, get("/api/auth/me", null).statusCode());
        HttpResponse<String> me = get("/api/auth/me", token);
        assertEquals(200, me.statusCode());
        JsonNode body = mapper.readTree(me.body());
        assertEquals(userId, body.get("id").asText());
        assertEquals(username, body.get("username").asText());
        assertEquals("ROLE_USER", body.get("role").asText());
    }

    @Test
    @DisplayName("H-02: user directory is admin-only")
    void userDirectoryIsAdminOnly() throws Exception {
        String username = "dir" + UUID.randomUUID().toString().substring(0, 8);
        HttpResponse<String> registration = post("/api/auth/register", null,
                "{\"username\":\"" + username + "\",\"email\":\"" + username + "@example.com\"," +
                        "\"password\":\"StrongP@ss123\"}");
        String userToken = mapper.readTree(registration.body()).get("token").asText();
        String userId = mapper.readTree(registration.body()).get("user").get("id").asText();

        assertEquals(401, get("/api/users", null).statusCode());
        assertEquals(403, get("/api/users", userToken).statusCode());
        assertEquals(403, get("/api/users/" + userId, userToken).statusCode());

        String adminToken = tokenService.issue("admin-id", "admin", "ROLE_ADMIN", 600);
        HttpResponse<String> list = get("/api/users", adminToken);
        assertEquals(200, list.statusCode());
        assertEquals(1, mapper.readTree(list.body()).size());

        HttpResponse<String> byId = get("/api/users/" + userId, adminToken);
        assertEquals(200, byId.statusCode());
        assertEquals(userId, mapper.readTree(byId.body()).get("id").asText());

        assertEquals(404, get("/api/users/" + UUID.randomUUID(), adminToken).statusCode());
    }

    @Test
    @DisplayName("H-02: forged tokens are rejected")
    void forgedTokensAreRejected() throws Exception {
        assertEquals(401, get("/api/auth/me", "v1.not-a-token.signature").statusCode());
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
