package com.causalotel.order.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import jakarta.annotation.PostConstruct;
import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;

@Configuration
public class PersistenceConfig {

    private static final Logger log = LoggerFactory.getLogger(PersistenceConfig.class);

    @Value("${spring.datasource.url}")
    private String datasourceUrl;

    @PostConstruct
    public void initializeDatabasePragmas() {
        try {
            String dbPath = datasourceUrl.replace("jdbc:sqlite:", "");
            File dbFile = new File(dbPath);
            if (dbFile.getParentFile() != null && !dbFile.getParentFile().exists()) {
                dbFile.getParentFile().mkdirs();
            }

            try (Connection conn = DriverManager.getConnection(datasourceUrl);
                 Statement stmt = conn.createStatement()) {
                stmt.execute("PRAGMA journal_mode = WAL;");
                stmt.execute("PRAGMA page_size = 4096;");
                log.info("Initialized SQLite WAL journal mode and 4KB page size for: {}", dbPath);
            }
        } catch (Exception e) {
            log.warn("Notice during SQLite database initialization: {}", e.getMessage());
        }
    }
}
