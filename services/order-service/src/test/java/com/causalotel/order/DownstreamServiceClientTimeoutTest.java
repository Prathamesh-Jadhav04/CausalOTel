package com.causalotel.order;

import com.causalotel.order.client.DownstreamServiceClient;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.ResourceAccessException;

import java.net.InetSocketAddress;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * H-09: downstream HTTP calls must fail fast instead of pinning a servlet
 * thread when a dependency accepts a connection but never responds.
 */
class DownstreamServiceClientTimeoutTest {

    @Test
    @DisplayName("H-09: a stalled product-service response is cut off by the read timeout")
    void readTimeoutIsBounded() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/products/SKU-SLOW", exchange -> {
            try {
                Thread.sleep(5_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            byte[] body = "{}".getBytes();
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();

        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            DownstreamServiceClient client = new DownstreamServiceClient(
                    "http://127.0.0.1:1", "http://127.0.0.1:1", baseUrl, 200, 300);

            long started = System.currentTimeMillis();
            assertThrows(ResourceAccessException.class,
                    () -> client.getProductBySku("SKU-SLOW"));
            long elapsed = System.currentTimeMillis() - started;

            assertTrue(elapsed < 3_000,
                    "Read timeout must bound the call (elapsed=" + elapsed + "ms)");
        } finally {
            server.stop(0);
        }
    }

    @Test
    @DisplayName("H-09: connection refusal fails fast")
    void connectionRefusedFailsFast() {
        DownstreamServiceClient client = new DownstreamServiceClient(
                "http://127.0.0.1:1", "http://127.0.0.1:1", "http://127.0.0.1:1", 200, 300);

        long started = System.currentTimeMillis();
        assertThrows(ResourceAccessException.class,
                () -> client.getProductBySku("SKU-ANY"));
        long elapsed = System.currentTimeMillis() - started;

        assertTrue(elapsed < 3_000,
                "Connection refusal must fail fast (elapsed=" + elapsed + "ms)");
    }
}
