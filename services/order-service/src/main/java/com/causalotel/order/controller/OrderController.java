package com.causalotel.order.controller;

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
@RequestMapping("/api/orders")
public class OrderController {

    private final DataSource dataSource;

    public OrderController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getOrders() throws SQLException {
        List<Map<String, Object>> orders = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, order_id, user_id, status, total_cents, created_at, updated_at FROM orders");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                Map<String, Object> o = new HashMap<>();
                o.put("id", rs.getInt("id"));
                o.put("order_id", rs.getString("order_id"));
                o.put("user_id", rs.getInt("user_id"));
                o.put("status", rs.getString("status"));
                o.put("total_cents", rs.getInt("total_cents"));
                o.put("created_at", rs.getLong("created_at"));
                o.put("updated_at", rs.getLong("updated_at"));
                orders.add(o);
            }
        }
        return ResponseEntity.ok(orders);
    }

    @GetMapping("/{orderId}")
    public ResponseEntity<Map<String, Object>> getOrderByOrderId(@PathVariable String orderId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, order_id, user_id, status, total_cents, created_at, updated_at FROM orders WHERE order_id = ?")) {
            ps.setString(1, orderId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    Map<String, Object> o = new HashMap<>();
                    o.put("id", rs.getInt("id"));
                    o.put("order_id", rs.getString("order_id"));
                    o.put("user_id", rs.getInt("user_id"));
                    o.put("status", rs.getString("status"));
                    o.put("total_cents", rs.getInt("total_cents"));
                    o.put("created_at", rs.getLong("created_at"));
                    o.put("updated_at", rs.getLong("updated_at"));
                    return ResponseEntity.ok(o);
                }
            }
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Order not found for orderId: " + orderId);
    }
}
