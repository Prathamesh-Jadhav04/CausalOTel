package com.causalotel.order.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * H-02: compact HMAC-SHA256 signed bearer tokens shared by all services.
 *
 * <p>Token format: {@code v1.<base64url(payload-json)>.<base64url(hmac)>}.
 * The signing key comes from {@code AUTH_TOKEN_SECRET} (or
 * {@code auth.token.secret}); a local-demo fallback is used only when neither
 * is set. Production deployments must set the environment variable.</p>
 */
@Component
public class TokenService {

    static final String DEV_ONLY_FALLBACK = "causalotel-local-dev-only-token-secret-do-not-use-in-production";
    private static final String ISSUER = "causalotel";
    private static final String PREFIX = "v1";

    private final byte[] secret;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public TokenService(@Value("${auth.token.secret:}") String configuredSecret) {
        String value = configuredSecret;
        if (value == null || value.isBlank()) {
            value = System.getenv("AUTH_TOKEN_SECRET");
        }
        if (value == null || value.isBlank()) {
            value = DEV_ONLY_FALLBACK;
        }
        if (value.length() < 32) {
            throw new IllegalStateException("AUTH_TOKEN_SECRET must be at least 32 characters");
        }
        this.secret = value.getBytes(StandardCharsets.UTF_8);
    }

    public String issue(String userId, String username, String role, long ttlSeconds) {
        long now = System.currentTimeMillis() / 1000L;
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("iss", ISSUER);
        payload.put("sub", userId);
        payload.put("username", username);
        payload.put("role", role);
        payload.put("iat", now);
        payload.put("exp", now + ttlSeconds);
        try {
            String payloadJson = objectMapper.writeValueAsString(payload);
            String encodedPayload = base64Url(payloadJson.getBytes(StandardCharsets.UTF_8));
            String signingInput = PREFIX + "." + encodedPayload;
            return signingInput + "." + base64Url(hmac(signingInput));
        } catch (Exception e) {
            throw new IllegalStateException("Failed to issue auth token", e);
        }
    }

    /** Short-lived credential for order -> inventory/payment/product calls. */
    public String issueServiceToken() {
        return issue("order-service", "order-service", "ROLE_SERVICE", 300);
    }

    @SuppressWarnings("unchecked")
    public AuthPrincipal verify(String token) {
        if (token == null || token.isBlank()) {
            throw new InvalidTokenException("Missing token");
        }
        String[] parts = token.split("\\.");
        if (parts.length != 3 || !PREFIX.equals(parts[0])) {
            throw new InvalidTokenException("Malformed token");
        }
        String signingInput = parts[0] + "." + parts[1];
        byte[] expected = hmac(signingInput);
        byte[] supplied;
        try {
            supplied = Base64.getUrlDecoder().decode(parts[2]);
        } catch (IllegalArgumentException e) {
            throw new InvalidTokenException("Malformed signature");
        }
        if (!MessageDigest.isEqual(expected, supplied)) {
            throw new InvalidTokenException("Invalid signature");
        }

        Map<String, Object> payload;
        try {
            payload = objectMapper.readValue(Base64.getUrlDecoder().decode(parts[1]), Map.class);
        } catch (Exception e) {
            throw new InvalidTokenException("Malformed payload");
        }
        if (!ISSUER.equals(payload.get("iss"))) {
            throw new InvalidTokenException("Unknown issuer");
        }
        Number exp = (Number) payload.get("exp");
        if (exp == null || exp.longValue() <= System.currentTimeMillis() / 1000L) {
            throw new InvalidTokenException("Token expired");
        }
        String subject = String.valueOf(payload.get("sub"));
        String role = String.valueOf(payload.get("role"));
        if (subject.isBlank() || !role.startsWith("ROLE_")) {
            throw new InvalidTokenException("Incomplete token claims");
        }
        return new AuthPrincipal(subject, String.valueOf(payload.getOrDefault("username", subject)), role);
    }

    private byte[] hmac(String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return mac.doFinal(input.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC unavailable", e);
        }
    }

    private static String base64Url(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    public static class InvalidTokenException extends RuntimeException {
        public InvalidTokenException(String message) {
            super(message);
        }
    }
}
