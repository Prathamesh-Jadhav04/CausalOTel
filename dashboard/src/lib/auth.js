/**
 * H-02 dashboard session handling. Tokens are issued by user-service and are
 * verified by every downstream service; the dashboard never invents identity.
 */

export const TOKEN_KEY = 'causalotel.dashboard.token';

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(padded);
}

export function decodeToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    return null;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    if (payload.iss !== 'causalotel') {
      return null;
    }
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
      return null;
    }
    if (!payload.sub || !payload.role) {
      return null;
    }
    return {
      token,
      userId: String(payload.sub),
      username: payload.username || String(payload.sub),
      role: String(payload.role),
      expiresAt: payload.exp * 1000
    };
  } catch {
    return null;
  }
}

export function readSession() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const session = decodeToken(token);
    if (!session) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveSession(token) {
  const session = decodeToken(token);
  if (!session) {
    throw new Error('The server returned an invalid or expired token.');
  }
  localStorage.setItem(TOKEN_KEY, token);
  return session;
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage may be unavailable in privacy modes; the in-memory state is authoritative.
  }
}

export function isAdminSession(session) {
  return session?.role === 'ROLE_ADMIN';
}
