package idgen

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

// GenerateID generates an ID with prefix in the format: prefix_<8_random_hex_bytes>
func GenerateID(prefix string) string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("生成随机 ID 失败: %v", err))
	}
	return prefix + "_" + hex.EncodeToString(b)
}

// GenerateAPIKey generates an API key in the format: sk-ant-api03-<40_random_bytes_base64url>
// (Claude API format compatible)
func GenerateAPIKey() string {
	b := make([]byte, 40)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("生成 API Key 失败: %v", err))
	}
	// base64url without padding
	encoded := base64.RawURLEncoding.EncodeToString(b)
	return "sk-ant-api03-" + encoded
}
