CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
    status TEXT NOT NULL, total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX idx_orders_order_id ON orders(order_id);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE TABLE order_items (
    id BIGSERIAL PRIMARY KEY, order_id TEXT NOT NULL, sku TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0), price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE TABLE saga_instances (
    id VARCHAR(36) PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, current_state TEXT NOT NULL,
    error_reason TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    lease_owner TEXT, lease_expires_at BIGINT NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0,
    commit_attempts INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);
CREATE INDEX idx_saga_instances_order_id ON saga_instances(order_id);
CREATE INDEX idx_saga_instances_state ON saga_instances(current_state);
CREATE INDEX idx_saga_instances_lease ON saga_instances(current_state, lease_expires_at);
CREATE TABLE outbox_tasks (
    id VARCHAR(36) PRIMARY KEY, saga_id TEXT NOT NULL, task_type TEXT NOT NULL, payload TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'PENDING', worker_id TEXT, lease_expires_at BIGINT NOT NULL DEFAULT 0,
    fencing_token INTEGER NOT NULL DEFAULT 0, retries INTEGER NOT NULL DEFAULT 0,
    next_attempt_at BIGINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX idx_outbox_tasks_state_lease ON outbox_tasks(state, lease_expires_at);
CREATE INDEX idx_outbox_tasks_claimable ON outbox_tasks(state, next_attempt_at, lease_expires_at);
CREATE TABLE order_idempotency (
    idempotency_key TEXT PRIMARY KEY, order_id TEXT NOT NULL, user_id TEXT,
    request_hash TEXT NOT NULL, response_status INTEGER NOT NULL, response_body TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'COMPLETED', created_at BIGINT NOT NULL
);
CREATE INDEX idx_order_idempotency_order_id ON order_idempotency(order_id);
CREATE INDEX idx_order_idempotency_user_id ON order_idempotency(user_id);
