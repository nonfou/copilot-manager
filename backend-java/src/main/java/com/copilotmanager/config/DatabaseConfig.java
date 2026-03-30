package com.copilotmanager.config;

import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;

@Configuration
public class DatabaseConfig implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(DatabaseConfig.class);

    private final DataSource dataSource;

    public DatabaseConfig(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public void destroy() {
        try (Connection c = dataSource.getConnection();
             Statement s = c.createStatement()) {
            s.execute("PRAGMA wal_checkpoint(PASSIVE)");
            log.info("WAL checkpoint completed on shutdown");
        } catch (Exception e) {
            log.warn("WAL checkpoint failed: {}", e.getMessage());
        }
        if (dataSource instanceof HikariDataSource hds) {
            hds.close();
        }
    }
}
