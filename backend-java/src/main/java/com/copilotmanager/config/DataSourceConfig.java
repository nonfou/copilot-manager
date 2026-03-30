package com.copilotmanager.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import javax.sql.DataSource;
import java.io.File;
import java.nio.file.Paths;

@Configuration
public class DataSourceConfig {

    private static final Logger log = LoggerFactory.getLogger(DataSourceConfig.class);

    @Bean
    @Primary
    public DataSource dataSource() {
        String dataDir = System.getenv("DATA_DIR");
        if (dataDir == null || dataDir.isBlank()) dataDir = "data";

        // Ensure data directory exists
        File dir = new File(dataDir);
        if (!dir.exists()) {
            if (dir.mkdirs()) {
                log.info("Created data directory: {}", dir.getAbsolutePath());
            } else {
                log.warn("Could not create data directory: {}", dir.getAbsolutePath());
            }
        }

        String dbPath = Paths.get(dataDir, "copilot-manager.db").toString().replace("\\", "/");
        String url = "jdbc:sqlite:" + dbPath
                + "?journal_mode=WAL&busy_timeout=5000&synchronous=NORMAL&foreign_keys=ON";
        log.info("SQLite DB: {}", url);

        HikariConfig config = new HikariConfig();
        config.setDriverClassName("org.sqlite.JDBC");
        config.setJdbcUrl(url);
        config.setMaximumPoolSize(1);
        config.setConnectionTimeout(10000);
        config.setIdleTimeout(600000);
        config.setMaxLifetime(1800000);
        return new HikariDataSource(config);
    }
}
