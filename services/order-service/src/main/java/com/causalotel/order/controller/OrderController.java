package com.causalotel.order.controller;

import com.causalotel.order.service.SagaOrchestrator;
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
    private final SagaOrchestrator sagaOrchestrator;

    public OrderController(DataSource dataSource, SagaOrchestrator sagaOrchestrator) {
        this.dataSource = dataSource;
        this.sagaOrchestrator = sagaOrchestrator;
    }

    @PostMapping("/checkout")
    public ResponseEntity<Map<String, Object>> checkout(@RequestBody SagaOrchestrator.CheckoutRequest request) throws Exception {
        Map<String, Object> order = sagaOrchestrator.checkout(request);
        return ResponseEntity.ok(order);
    }

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getOrders() throws SQLException {
        List<Map<String, Object>> orders = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, order_id, user_id, status, total_cents, created_at, updated_at FROM orders ORDER BY created_at DESC");
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

    @GetMapping("/{orderId}/items")
    public ResponseEntity<List<Map<String, Object>>> getOrderItems(@PathVariable String orderId) throws SQLException {
        List<Map<String, Object>> items = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, order_id, sku, quantity, price_cents FROM order_items WHERE order_id = ?")) {
            ps.setString(1, orderId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> item = new HashMap<>();
                    item.put("id", rs.getInt("id"));
                    item.put("order_id", rs.getString("order_id"));
                    item.put("sku", rs.getString("sku"));
                    item.put("quantity", rs.getInt("quantity"));
                    item.put("price_cents", rs.getInt("price_cents"));
                    items.add(item);
                }
            }
        }
        return ResponseEntity.ok(items);
    }

    @GetMapping("/{orderId}/saga")
    public ResponseEntity<Map<String, Object>> getSagaInstance(@PathVariable String orderId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, order_id, current_state, error_reason, created_at, updated_at FROM saga_instances WHERE order_id = ?")) {
            ps.setString(1, orderId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    Map<String, Object> s = new HashMap<>();
                    s.put("id", rs.getString("id"));
                    s.put("order_id", rs.getString("order_id"));
                    s.put("current_state", rs.getString("current_state"));
                    s.put("error_reason", rs.getString("error_reason"));
                    s.put("created_at", rs.getLong("created_at"));
                    s.put("updated_at", rs.getLong("updated_at"));
                    return ResponseEntity.ok(s);
                }
            }
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Saga instance not found for orderId: " + orderId);
    }

    @GetMapping("/outbox")
    public ResponseEntity<List<Map<String, Object>>> getOutboxTasks() throws SQLException {
        List<Map<String, Object>> tasks = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, saga_id, task_type, payload, state, worker_id, retries, created_at, updated_at FROM outbox_tasks ORDER BY created_at DESC LIMIT 50");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                Map<String, Object> t = new HashMap<>();
                t.put("id", rs.getString("id"));
                t.put("saga_id", rs.getString("saga_id"));
                t.put("task_type", rs.getString("task_type"));
                t.put("payload", rs.getString("payload"));
                t.put("state", rs.getString("state"));
                t.put("worker_id", rs.getString("worker_id"));
                t.put("retries", rs.getInt("retries"));
                t.put("created_at", rs.getLong("created_at"));
                t.put("updated_at", rs.getLong("updated_at"));
                tasks.add(t);
            }
        }
        return ResponseEntity.ok(tasks);
    }
}
