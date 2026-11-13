-- Product Service Schema V2: Seed Catalog Products
INSERT OR IGNORE INTO products (sku, name, description, price_cents, stock_quantity, created_at, updated_at)
VALUES 
    ('SKU-LAPTOP-001', 'Quantum Pro Laptop 16"', 'High performance developer workstation with 32GB RAM and 1TB SSD', 129999, 50, 1700000000000, 1700000000000),
    ('SKU-PHONE-002', 'Nexus Horizon Phone 5G', 'Flagship smartphone with OLED display and triple camera system', 79999, 100, 1700000000000, 1700000000000),
    ('SKU-HEADPHONES-003', 'AeroSound ANC Headphones', 'Wireless active noise-cancelling premium over-ear headphones', 19999, 200, 1700000000000, 1700000000000),
    ('SKU-OUT-OF-STOCK-004', 'Vintage Mechanical Keyboard', 'Custom mechanical keyboard with tactile switches (Currently Sold Out)', 14999, 0, 1700000000000, 1700000000000);
