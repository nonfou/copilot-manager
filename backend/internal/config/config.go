package config

import (
	"os"
	"strconv"
)

// Config holds all application configuration loaded from environment variables.
type Config struct {
	EncryptionKey       string
	Port                string
	AdminUsername       string
	AdminPassword       string
	CORSAllowedOrigins  string
	RateLimitPerMinute  int
	TrustedProxy        bool
	NodeEnv             string
	HTTPS               bool
}

// Load reads configuration from environment variables.
func Load() *Config {
	rateLimit := 300
	if v := os.Getenv("RATE_LIMIT_PER_MINUTE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			rateLimit = n
		}
	}

	return &Config{
		EncryptionKey:      os.Getenv("ENCRYPTION_KEY"),
		Port:               getEnvOrDefault("PORT", "4242"),
		AdminUsername:      os.Getenv("ADMIN_USERNAME"),
		AdminPassword:      os.Getenv("ADMIN_PASSWORD"),
		CORSAllowedOrigins: os.Getenv("CORS_ALLOWED_ORIGINS"),
		RateLimitPerMinute: rateLimit,
		TrustedProxy:       os.Getenv("TRUSTED_PROXY") == "true",
		NodeEnv:            os.Getenv("NODE_ENV"),
		HTTPS:              os.Getenv("HTTPS") == "true",
	}
}

func getEnvOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
