package com.causalotel.product.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final DataSource dataSource;

    public ProductController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getProducts() throws SQLException {
        List<Map<String, Object>> products = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, sku, name, description, price_cents, stock_quantity, created_at, updated_at FROM products");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                Map<String, Object> p = new HashMap<>();
                p.put("id", rs.getInt("id"));
                p.put("sku", rs.getString("sku"));
                p.put("name", rs.getString("name"));
                p.put("description", rs.getString("description"));
                p.put("price_cents", rs.getInt("price_cents"));
                p.put("stock_quantity", rs.getInt("stock_quantity"));
                p.put("created_at", rs.getLong("created_at"));
                p.put("updated_at", rs.getLong("updated_at"));
                products.add(p);
            }
        }
        return ResponseEntity.ok(products);
    }

    @GetMapping("/{sku}")
    public ResponseEntity<Map<String, Object>> getProductBySku(@PathVariable String sku) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, sku, name, description, price_cents, stock_quantity, created_at, updated_at FROM products WHERE sku = ?")) {
            ps.setString(1, sku);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    Map<String, Object> p = new HashMap<>();
                    p.put("id", rs.getInt("id"));
                    p.put("sku", rs.getString("sku"));
                    p.put("name", rs.getString("name"));
                    p.put("description", rs.getString("description"));
                    p.put("price_cents", rs.getInt("price_cents"));
                    p.put("stock_quantity", rs.getInt("stock_quantity"));
                    p.put("created_at", rs.getLong("created_at"));
                    p.put("updated_at", rs.getLong("updated_at"));
                    return ResponseEntity.ok(p);
                }
            }
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Product not found for SKU: " + sku);
    }
}
