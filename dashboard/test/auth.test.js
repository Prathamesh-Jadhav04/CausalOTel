import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSession,
  decodeToken,
  isAdminSession,
  readSession,
  saveSession,
  TOKEN_KEY
} from '../src/lib/auth.js';

function makeToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `v1.${encoded}.signature`;
}

function validPayload(overrides = {}) {
  return {
    iss: 'causalotel',
    sub: '11111111-2222-3333-4444-555555555555',
    username: 'alice',
    role: 'ROLE_USER',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides
  };
}

function installStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };
  return store;
}

describe('dashboard session decoding', () => {
  beforeEach(() => {
    installStorage();
  });

  test('accepts a valid HMAC bearer token payload', () => {
    const session = decodeToken(makeToken(validPayload()));
    assert.equal(session.userId, '11111111-2222-3333-4444-555555555555');
    assert.equal(session.username, 'alice');
    assert.equal(session.role, 'ROLE_USER');
    assert.ok(session.expiresAt > Date.now());
  });

  test('rejects tokens with the wrong issuer', () => {
    assert.equal(decodeToken(makeToken(validPayload({ iss: 'someone-else' }))), null);
  });

  test('rejects expired tokens', () => {
    assert.equal(decodeToken(makeToken(validPayload({ exp: 1 }))), null);
  });

  test('rejects malformed token shapes', () => {
    assert.equal(decodeToken('not-a-token'), null);
    assert.equal(decodeToken('v2.abc.def'), null);
    assert.equal(decodeToken(''), null);
    assert.equal(decodeToken(null), null);
  });

  test('rejects tokens without a subject or role', () => {
    assert.equal(decodeToken(makeToken(validPayload({ sub: undefined }))), null);
    assert.equal(decodeToken(makeToken(validPayload({ role: undefined }))), null);
  });

  test('persists, reloads, and clears the session token', () => {
    const token = makeToken(validPayload({ role: 'ROLE_ADMIN' }));
    const saved = saveSession(token);
    assert.equal(saved.role, 'ROLE_ADMIN');
    assert.equal(readSession().token, token);
    assert.equal(isAdminSession(saved), true);
    clearSession();
    assert.equal(readSession(), null);
  });

  test('refuses to persist an invalid token', () => {
    assert.throws(() => saveSession('v1.invalid.signature'), /invalid or expired/);
    assert.equal(localStorage.getItem(TOKEN_KEY), null);
  });

  test('drops a stale token from storage on read', () => {
    localStorage.setItem(TOKEN_KEY, makeToken(validPayload({ exp: 1 })));
    assert.equal(readSession(), null);
    assert.equal(localStorage.getItem(TOKEN_KEY), null);
  });
});
