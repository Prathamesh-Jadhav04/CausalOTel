CREATE TABLE bootstrap_tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1), token_hash VARCHAR(64) NOT NULL,
    expires_at BIGINT NOT NULL, consumed_at BIGINT, failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until BIGINT, created_at BIGINT NOT NULL
);
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(128) NOT NULL UNIQUE, password_hash VARCHAR(128) NOT NULL,
    role VARCHAR(32) NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT
);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
