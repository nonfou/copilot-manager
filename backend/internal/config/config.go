package config

import (
	"os"
	"strconv"
	"strings"
)

// Config holds all application configuration loaded from environment variables.
type Config struct {
	EncryptionKey         string
	Port                  string
	AdminUsername         string
	AdminPassword         string
	CORSAllowedOrigins    string
	RateLimitPerMinute    int
	TrustedProxy          bool
	NodeEnv               string
	HTTPS                 bool
	MaxProxyBodySizeBytes int64
	CacheTTLSeconds       int
	LogRetentionCount     int
}

// Load reads configuration from environment variables.
func Load() *Config {
	rateLimit := parseIntEnv("RATE_LIMIT_PER_MINUTE", 300)
	cacheTTL := parseIntEnv("CACHE_TTL_SECONDS", 120)
	logRetention := parseIntEnv("LOG_RETENTION_COUNT", 2000)
	maxProxyBodySize := parseBytesEnv("MAX_PROXY_BODY_SIZE", 16*1024*1024)

	return &Config{
		EncryptionKey:         os.Getenv("ENCRYPTION_KEY"),
		Port:                  getEnvOrDefault("PORT", "4242"),
		AdminUsername:         os.Getenv("ADMIN_USERNAME"),
		AdminPassword:         os.Getenv("ADMIN_PASSWORD"),
		CORSAllowedOrigins:    os.Getenv("CORS_ALLOWED_ORIGINS"),
		RateLimitPerMinute:    rateLimit,
		TrustedProxy:          os.Getenv("TRUSTED_PROXY") == "true",
		NodeEnv:               os.Getenv("NODE_ENV"),
		HTTPS:                 os.Getenv("HTTPS") == "true",
		MaxProxyBodySizeBytes: maxProxyBodySize,
		CacheTTLSeconds:       cacheTTL,
		LogRetentionCount:     logRetention,
	}
}

func parseIntEnv(name string, defaultVal int) int {
	if v := os.Getenv(name); v != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n > 0 {
			return n
		}
	}
	return defaultVal
}

func parseBytesEnv(name string, defaultVal int64) int64 {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return defaultVal
	}

	multipliers := map[string]int64{
		"k":   1024,
		"kb":  1024,
		"kib": 1024,
		"m":   1024 * 1024,
		"mb":  1024 * 1024,
		"mib": 1024 * 1024,
		"g":   1024 * 1024 * 1024,
		"gb":  1024 * 1024 * 1024,
		"gib": 1024 * 1024 * 1024,
	}

	lower := strings.ToLower(v)
	for suffix, mul := range multipliers {
		if strings.HasSuffix(lower, suffix) {
			numPart := strings.TrimSpace(lower[:len(lower)-len(suffix)])
			if n, err := strconv.ParseInt(numPart, 10, 64); err == nil && n > 0 {
				return n * mul
			}
			return defaultVal
		}
	}

	if n, err := strconv.ParseInt(lower, 10, 64); err == nil && n > 0 {
		return n
	}
	return defaultVal
}

func getEnvOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
