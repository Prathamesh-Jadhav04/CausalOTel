-- Order Service Schema V2: Saga Instances and Transactional Outbox
CREATE TABLE IF NOT EXISTS saga_instances (
    id VARCHAR(36) PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE,
    current_state TEXT NOT NULL,
    error_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saga_instances_order_id ON saga_instances(order_id);
CREATE INDEX IF NOT EXISTS idx_saga_instances_state ON saga_instances(current_state);

CREATE TABLE IF NOT EXISTS outbox_tasks (
    id VARCHAR(36) PRIMARY KEY,
    saga_id TEXT NOT NULL,
    task_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'PENDING',
    worker_id TEXT,
    lease_expires_at INTEGER NOT NULL DEFAULT 0,
    fencing_token INTEGER NOT NULL DEFAULT 0,
    retries INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_tasks_state_lease ON outbox_tasks(state, lease_expires_at);

CREATE TABLE IF NOT EXISTS order_idempotency (
    idempotency_key TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
