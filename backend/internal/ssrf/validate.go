package ssrf

import (
	"fmt"
	"net"
	"regexp"
	"strings"
)

// ValidateAPIURL validates that the given URL is safe to use as an api_url.
// Only http/https is allowed, and loopback/private IP addresses are rejected.
func ValidateAPIURL(raw string) error {
	if raw == "" {
		return fmt.Errorf("api_url 不能为空")
	}

	// Simple URL parsing without importing net/url for better control
	var protocol, host string
	if strings.HasPrefix(raw, "https://") {
		protocol = "https"
		host = raw[8:]
	} else if strings.HasPrefix(raw, "http://") {
		protocol = "http"
		host = raw[7:]
	} else {
		return fmt.Errorf("api_url 只允许 http 或 https 协议")
	}
	_ = protocol

	// Extract hostname (remove path, port)
	if idx := strings.IndexByte(host, '/'); idx >= 0 {
		host = host[:idx]
	}
	// Remove port
	hostname := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		hostname = h
	}
	hostname = strings.ToLower(hostname)
	// Remove brackets from IPv6
	hostname = strings.Trim(hostname, "[]")

	// Reject loopback
	if hostname == "localhost" || hostname == "::1" || hostname == "0:0:0:0:0:0:0:1" {
		return fmt.Errorf("api_url 不允许指向 loopback 地址")
	}
	if matched, _ := regexp.MatchString(`^127\.`, hostname); matched {
		return fmt.Errorf("api_url 不允许指向 loopback 地址")
	}

	// Reject private IP ranges
	privatePatterns := []string{
		`^10\.`,
		`^172\.(1[6-9]|2\d|3[01])\.`,
		`^192\.168\.`,
		`^169\.254\.`, // link-local
		`^fc[0-9a-f]{2}:`,  // IPv6 ULA (fc00::/7)
		`^fd[0-9a-f]{2}:`,  // IPv6 ULA (fc00::/7)
		`^fe80:`,       // IPv6 link-local
	}
	for _, pattern := range privatePatterns {
		if matched, _ := regexp.MatchString(pattern, hostname); matched {
			return fmt.Errorf("api_url 不允许指向私有/内网 IP 地址")
		}
	}

	return nil
}
