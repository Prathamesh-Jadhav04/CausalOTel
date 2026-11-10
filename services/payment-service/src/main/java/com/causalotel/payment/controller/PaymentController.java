package com.causalotel.payment.controller;

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
@RequestMapping("/api/payments")
public class PaymentController {

    private final DataSource dataSource;

    public PaymentController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getPayments() throws SQLException {
        List<Map<String, Object>> payments = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, payment_id, order_id, amount_cents, currency, status, created_at, updated_at FROM payments");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                Map<String, Object> p = new HashMap<>();
                p.put("id", rs.getInt("id"));
                p.put("payment_id", rs.getString("payment_id"));
                p.put("order_id", rs.getString("order_id"));
                p.put("amount_cents", rs.getInt("amount_cents"));
                p.put("currency", rs.getString("currency"));
                p.put("status", rs.getString("status"));
                p.put("created_at", rs.getLong("created_at"));
                p.put("updated_at", rs.getLong("updated_at"));
                payments.add(p);
            }
        }
        return ResponseEntity.ok(payments);
    }

    @GetMapping("/{paymentId}")
    public ResponseEntity<Map<String, Object>> getPaymentByPaymentId(@PathVariable String paymentId) throws SQLException {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT id, payment_id, order_id, amount_cents, currency, status, created_at, updated_at FROM payments WHERE payment_id = ?")) {
            ps.setString(1, paymentId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    Map<String, Object> p = new HashMap<>();
                    p.put("id", rs.getInt("id"));
                    p.put("payment_id", rs.getString("payment_id"));
                    p.put("order_id", rs.getString("order_id"));
                    p.put("amount_cents", rs.getInt("amount_cents"));
                    p.put("currency", rs.getString("currency"));
                    p.put("status", rs.getString("status"));
                    p.put("created_at", rs.getLong("created_at"));
                    p.put("updated_at", rs.getLong("updated_at"));
                    return ResponseEntity.ok(p);
                }
            }
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Payment not found for paymentId: " + paymentId);
    }
}
