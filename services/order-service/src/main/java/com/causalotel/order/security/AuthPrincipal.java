package com.causalotel.order.security;

/**
 * Authenticated caller identity extracted from a signed bearer token.
 * userId is the user-service UUID string (M-04 standardization).
 */
public record AuthPrincipal(String userId, String username, String role) {

    public boolean isAdmin() {
        return "ROLE_ADMIN".equals(role);
    }

    public boolean isService() {
        return "ROLE_SERVICE".equals(role);
    }
}
