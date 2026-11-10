-- Payment Service Schema V3: Track cumulative refunded amount
ALTER TABLE payments ADD COLUMN refunded_amount_cents INTEGER NOT NULL DEFAULT 0;
