package com.copilotmanager;

import com.copilotmanager.config.AppProperties;
import com.copilotmanager.crypto.EncryptionService;
import com.copilotmanager.model.SystemConfig;
import com.copilotmanager.model.User;
import com.copilotmanager.repository.SystemConfigRepository;
import com.copilotmanager.service.KeyCacheService;
import com.copilotmanager.service.UserService;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(AppProperties.class)
public class CopilotManagerApplication {

    private static final Logger log = LoggerFactory.getLogger(CopilotManagerApplication.class);

    private final AppProperties appProperties;
    private final SystemConfigRepository systemConfigRepository;
    private final UserService userService;
    private final KeyCacheService keyCacheService;
    private final EncryptionService encryptionService;

    public CopilotManagerApplication(AppProperties appProperties,
                                      SystemConfigRepository systemConfigRepository,
                                      UserService userService,
                                      KeyCacheService keyCacheService,
                                      EncryptionService encryptionService) {
        this.appProperties = appProperties;
        this.systemConfigRepository = systemConfigRepository;
        this.userService = userService;
        this.keyCacheService = keyCacheService;
        this.encryptionService = encryptionService;
    }

    public static void main(String[] args) {
        SpringApplication.run(CopilotManagerApplication.class, args);
    }

    @PostConstruct
    public void initAdminFromEnv() {
        String adminUsername = appProperties.getAdminUsername();
        String adminPassword = appProperties.getAdminPassword();
        if (adminUsername == null || adminUsername.isBlank()) {
            return;
        }
        if (adminPassword == null || adminPassword.length() < 6) {
            log.warn("ADMIN_PASSWORD must be at least 6 characters, skipping admin init");
            return;
        }

        SystemConfig cfg = systemConfigRepository.findById(1)
                .orElse(null);
        if (cfg != null && cfg.isInitialized()) {
            return;
        }

        if (userService.findByUsername(adminUsername) == null) {
            User admin = userService.createUser(adminUsername, adminPassword, "admin", null);
            log.info("Admin user created: {}", admin.getUsername());
        }

        if (cfg == null) {
            cfg = new SystemConfig();
            cfg.setId(1);
        }
        cfg.setInitialized(true);
        cfg.setAdminCreatedAt(java.time.Instant.now().toString());
        systemConfigRepository.save(cfg);
        log.info("System initialized");
    }
}
