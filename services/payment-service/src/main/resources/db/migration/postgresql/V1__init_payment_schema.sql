CREATE TABLE payments (
    id BIGSERIAL PRIMARY KEY, payment_id TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL UNIQUE,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0), currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL, refunded_amount_cents INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX idx_payments_payment_id ON payments(payment_id);
CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE TABLE refunds (
    id BIGSERIAL PRIMARY KEY, refund_id TEXT NOT NULL UNIQUE, payment_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), status TEXT NOT NULL,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    FOREIGN KEY (payment_id) REFERENCES payments(payment_id) ON DELETE RESTRICT
);
CREATE INDEX idx_refunds_refund_id ON refunds(refund_id);
CREATE INDEX idx_refunds_payment_id ON refunds(payment_id);
CREATE TABLE payment_idempotency (
    idempotency_key TEXT PRIMARY KEY, payment_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    response_body TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE payment_attempts (
    id BIGSERIAL PRIMARY KEY, payment_id TEXT NOT NULL, attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL, gateway_reference TEXT, gateway_response_code TEXT, error_message TEXT,
    created_at BIGINT NOT NULL, FOREIGN KEY (payment_id) REFERENCES payments(payment_id) ON DELETE CASCADE
);
CREATE INDEX idx_payment_attempts_payment_id ON payment_attempts(payment_id);
