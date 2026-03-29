package crypto

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"

	"golang.org/x/crypto/scrypt"
)

const (
	saltLength = 16
	keyLength  = 64
	// Node.js scrypt default N=16384, r=8, p=1
	scryptN = 16384
	scryptR = 8
	scryptP = 1
)

// HashPassword hashes a password using scrypt with a random salt.
// Returns format: saltHex:dkHex (compatible with TS implementation)
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("生成 salt 失败: %w", err)
	}
	dk, err := scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, keyLength)
	if err != nil {
		return "", fmt.Errorf("scrypt 失败: %w", err)
	}
	return hex.EncodeToString(salt) + ":" + hex.EncodeToString(dk), nil
}

// VerifyPassword verifies a password against a stored hash.
// Supports the saltHex:dkHex format used by both TS and Go implementations.
func VerifyPassword(password, stored string) (bool, error) {
	parts := strings.SplitN(stored, ":", 2)
	if len(parts) != 2 {
		return false, fmt.Errorf("hash 格式无效")
	}
	saltBytes, err := hex.DecodeString(parts[0])
	if err != nil {
		return false, fmt.Errorf("salt hex 解码失败: %w", err)
	}
	expectedBytes, err := hex.DecodeString(parts[1])
	if err != nil {
		return false, fmt.Errorf("hash hex 解码失败: %w", err)
	}
	dk, err := scrypt.Key([]byte(password), saltBytes, scryptN, scryptR, scryptP, keyLength)
	if err != nil {
		return false, fmt.Errorf("scrypt 失败: %w", err)
	}
	// Constant-time comparison
	if len(dk) != len(expectedBytes) {
		return false, nil
	}
	diff := 0
	for i := range dk {
		diff |= int(dk[i] ^ expectedBytes[i])
	}
	return diff == 0, nil
}
