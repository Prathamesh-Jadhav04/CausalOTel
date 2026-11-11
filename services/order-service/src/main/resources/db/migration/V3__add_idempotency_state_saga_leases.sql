-- Order Service Schema V3: Idempotency ownership/state, outbox backoff, saga leases.
-- These columns make idempotency claims durable and user-bound (H-03), allow
-- transactional terminal writes (H-06), and let recovery claim sagas with a
-- lease/fencing token instead of racing an active checkout (H-07).

ALTER TABLE order_idempotency ADD COLUMN user_id INTEGER;
ALTER TABLE order_idempotency ADD COLUMN state TEXT NOT NULL DEFAULT 'COMPLETED';

CREATE INDEX IF NOT EXISTS idx_order_idempotency_order_id ON order_idempotency(order_id);
CREATE INDEX IF NOT EXISTS idx_order_idempotency_user_id ON order_idempotency(user_id);

ALTER TABLE outbox_tasks ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_outbox_tasks_claimable
    ON outbox_tasks(state, next_attempt_at, lease_expires_at);

ALTER TABLE saga_instances ADD COLUMN lease_owner TEXT;
ALTER TABLE saga_instances ADD COLUMN lease_expires_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE saga_instances ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_saga_instances_lease
    ON saga_instances(current_state, lease_expires_at);
