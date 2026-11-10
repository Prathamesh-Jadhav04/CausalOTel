-- V1__init_user_schema.sql
-- Single-row admin bootstrap token governance table
CREATE TABLE IF NOT EXISTS bootstrap_tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token_hash VARCHAR(64) NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NULL,
    created_at INTEGER NOT NULL
);

-- User accounts table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(128) NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,
    role VARCHAR(32) NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
