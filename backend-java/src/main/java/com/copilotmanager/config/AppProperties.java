package com.copilotmanager.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "")
public class AppProperties {

    private String encryptionKey = System.getenv("ENCRYPTION_KEY");
    private String adminUsername = System.getenv("ADMIN_USERNAME");
    private String adminPassword = System.getenv("ADMIN_PASSWORD");
    private String corsAllowedOrigins = System.getenv("CORS_ALLOWED_ORIGINS");
    private int rateLimitPerMinute = parseIntEnv("RATE_LIMIT_PER_MINUTE", 300);
    private boolean trustedProxy = "true".equalsIgnoreCase(System.getenv("TRUSTED_PROXY"));
    private boolean production = "production".equalsIgnoreCase(System.getenv("NODE_ENV"));
    private boolean httpsEnabled = "true".equalsIgnoreCase(System.getenv("HTTPS"));

    private static int parseIntEnv(String name, int def) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) return def;
        try { return Integer.parseInt(v.trim()); } catch (NumberFormatException e) { return def; }
    }

    public String getEncryptionKey() { return encryptionKey; }
    public String getAdminUsername() { return adminUsername; }
    public String getAdminPassword() { return adminPassword; }
    public String getCorsAllowedOrigins() { return corsAllowedOrigins; }
    public int getRateLimitPerMinute() { return rateLimitPerMinute; }
    public boolean isTrustedProxy() { return trustedProxy; }
    public boolean isProduction() { return production; }
    public boolean isHttpsEnabled() { return httpsEnabled; }
    public boolean isSecureCookie() { return production || httpsEnabled; }
}
