package com.causalotel.product;

import com.causalotel.product.controller.HealthController;
import com.causalotel.product.controller.ProductController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class ProductServiceTest {

    @Autowired
    private HealthController healthController;

    @Autowired
    private ProductController productController;

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("Product service context loads successfully")
    void contextLoads() {
        assertNotNull(healthController);
        assertNotNull(productController);
        assertNotNull(dataSource);
    }

    @Test
    @DisplayName("Health live endpoint returns status UP")
    void testHealthLive() {
        ResponseEntity<Map<String, Object>> response = healthController.live();
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("UP", response.getBody().get("status"));
        assertEquals("product-service", response.getBody().get("service"));
    }

    @Test
    @DisplayName("Health ready endpoint returns status UP and database connectivity")
    void testHealthReady() {
        ResponseEntity<Map<String, Object>> response = healthController.ready();
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("UP", response.getBody().get("status"));
        assertEquals("UP", response.getBody().get("database"));
    }

    @Test
    @DisplayName("Verify effective PRAGMAs on pooled SQLite connections")
    void testPooledConnectionPragmas() throws SQLException {
        for (int i = 0; i < 3; i++) {
            try (Connection conn = dataSource.getConnection();
                 Statement stmt = conn.createStatement()) {

                try (ResultSet rs = stmt.executeQuery("PRAGMA foreign_keys;")) {
                    assertTrue(rs.next());
                    assertEquals(1, rs.getInt(1), "foreign_keys must be 1 (ON)");
                }

                try (ResultSet rs = stmt.executeQuery("PRAGMA busy_timeout;")) {
                    assertTrue(rs.next());
                    assertEquals(5000, rs.getInt(1), "busy_timeout must be 5000ms");
                }

                try (ResultSet rs = stmt.executeQuery("PRAGMA journal_mode;")) {
                    assertTrue(rs.next());
                    assertEquals("wal", rs.getString(1).toLowerCase(), "journal_mode must be wal");
                }

                try (ResultSet rs = stmt.executeQuery("PRAGMA synchronous;")) {
                    assertTrue(rs.next());
                    assertEquals(1, rs.getInt(1), "synchronous must be 1 (NORMAL)");
                }
            }
        }
    }

    @Test
    @DisplayName("GET /api/products returns product list")
    void testGetProducts() throws SQLException {
        ResponseEntity<List<Map<String, Object>>> response = productController.getProducts();
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
    }

    @Test
    @DisplayName("GET /api/products/{sku} for missing SKU throws 404 NOT_FOUND")
    void testGetMissingProductThrows404() {
        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () ->
                productController.getProductBySku("NON_EXISTENT_SKU_999")
        );
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatusCode());
    }
}
