CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    description TEXT, price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX idx_products_sku ON products(sku);
INSERT INTO products (sku, name, description, price_cents, stock_quantity, created_at, updated_at) VALUES
 ('SKU-LAPTOP-001', 'Quantum Pro Laptop 16"', 'High performance developer workstation with 32GB RAM and 1TB SSD', 129999, 50, 1700000000000, 1700000000000),
 ('SKU-PHONE-002', 'Nexus Horizon Phone 5G', 'Flagship smartphone with OLED display and triple camera system', 79999, 100, 1700000000000, 1700000000000),
 ('SKU-HEADPHONES-003', 'AeroSound ANC Headphones', 'Wireless active noise-cancelling premium over-ear headphones', 19999, 200, 1700000000000, 1700000000000),
 ('SKU-OUT-OF-STOCK-004', 'Vintage Mechanical Keyboard', 'Custom mechanical keyboard with tactile switches (Currently Sold Out)', 14999, 0, 1700000000000, 1700000000000)
ON CONFLICT (sku) DO NOTHING;
