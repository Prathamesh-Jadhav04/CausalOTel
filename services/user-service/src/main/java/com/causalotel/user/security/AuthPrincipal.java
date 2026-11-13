package com.causalotel.user.security;

public record AuthPrincipal(String userId, String username, String role) {

    public boolean isAdmin() {
        return "ROLE_ADMIN".equals(role);
    }

    public boolean isService() {
        return "ROLE_SERVICE".equals(role);
    }
}
