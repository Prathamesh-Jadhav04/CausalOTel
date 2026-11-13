-- M-04: standardize order identity on user-service UUID strings.
-- SQLite cannot ALTER COLUMN, so rebuild the affected tables. This migration
-- must run outside a transaction so foreign_keys can be disabled while the
-- parent orders table is replaced (otherwise the implicit delete would cascade
-- into saga_instances and order_idempotency).
PRAGMA foreign_keys = OFF;

CREATE TABLE orders_v4 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
INSERT INTO orders_v4 (id, order_id, user_id, status, total_cents, created_at, updated_at)
SELECT id, order_id, CAST(user_id AS TEXT), status, total_cents, created_at, updated_at FROM orders;

CREATE TABLE order_items_v4 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    FOREIGN KEY (order_id) REFERENCES orders_v4(order_id) ON DELETE CASCADE
);
INSERT INTO order_items_v4 (id, order_id, sku, quantity, price_cents)
SELECT id, order_id, sku, quantity, price_cents FROM order_items;

CREATE TABLE order_idempotency_v4 (
    idempotency_key TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    user_id TEXT,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'COMPLETED',
    created_at INTEGER NOT NULL
);
INSERT INTO order_idempotency_v4 (idempotency_key, order_id, user_id, request_hash,
                                  response_status, response_body, state, created_at)
SELECT idempotency_key, order_id, CAST(user_id AS TEXT), request_hash,
       response_status, response_body, state, created_at FROM order_idempotency;

DROP TABLE order_items;
DROP TABLE orders;
DROP TABLE order_idempotency;

ALTER TABLE orders_v4 RENAME TO orders;
ALTER TABLE order_items_v4 RENAME TO order_items;
ALTER TABLE order_idempotency_v4 RENAME TO order_idempotency;

CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_idempotency_order_id ON order_idempotency(order_id);
CREATE INDEX IF NOT EXISTS idx_order_idempotency_user_id ON order_idempotency(user_id);

PRAGMA foreign_keys = ON;
