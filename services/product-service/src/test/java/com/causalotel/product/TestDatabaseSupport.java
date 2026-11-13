package com.causalotel.product;

import org.springframework.test.context.DynamicPropertyRegistry;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Comparator;

/**
 * Creates a per-run temporary SQLite database and refuses destructive test
 * cleanup unless the connection is demonstrably outside the live CausalOTel
 * data directory.
 */
public final class TestDatabaseSupport {

    private static final Path TEST_ROOT = createTestRoot();

    private TestDatabaseSupport() {
    }

    private static Path createTestRoot() {
        try {
            Path root = Files.createTempDirectory("causalotel-product-test-").toAbsolutePath().normalize();
            Runtime.getRuntime().addShutdownHook(new Thread(() -> deleteRecursively(root)));
            return root;
        } catch (IOException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public static void register(DynamicPropertyRegistry registry, String databaseFileName) {
        Path database = TEST_ROOT.resolve(databaseFileName).toAbsolutePath().normalize();
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + database);
    }

    public static void assertIsolated(DataSource dataSource) {
        try (Connection connection = dataSource.getConnection()) {
            assertIsolatedUrl(connection.getMetaData().getURL());
        } catch (SQLException e) {
            throw new IllegalStateException("Could not verify test database isolation", e);
        }
    }

    public static void assertIsolatedUrl(String jdbcUrl) {
        if (jdbcUrl == null || !jdbcUrl.startsWith("jdbc:sqlite:")) {
            throw new IllegalStateException("Refusing destructive test cleanup: unexpected JDBC URL " + jdbcUrl);
        }

        Path database = Path.of(jdbcUrl.substring("jdbc:sqlite:".length())).toAbsolutePath().normalize();
        Path tempRoot = Path.of(System.getProperty("java.io.tmpdir")).toAbsolutePath().normalize();
        if (!database.startsWith(tempRoot)) {
            throw new IllegalStateException(
                    "Refusing destructive test cleanup outside the temp directory: " + database);
        }

        String localAppData = System.getenv("LOCALAPPDATA");
        if (localAppData != null && !localAppData.isBlank()) {
            Path liveData = Path.of(localAppData, "CausalOTel", "data").toAbsolutePath().normalize();
            if (database.startsWith(liveData)) {
                throw new IllegalStateException(
                        "Refusing destructive test cleanup against live CausalOTel data: " + database);
            }
        }
    }

    private static void deleteRecursively(Path root) {
        if (root == null || !Files.exists(root)) {
            return;
        }
        try (var paths = Files.walk(root)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // Best-effort cleanup of the isolated test directory only.
                }
            });
        } catch (IOException ignored) {
            // Best-effort cleanup of the isolated test directory only.
        }
    }
}
