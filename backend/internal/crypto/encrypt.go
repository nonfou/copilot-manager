package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"regexp"
	"strings"
)

const encPrefix = "enc:"

var encryptionKey []byte

// InitEncryption initializes the AES-256-GCM encryption key from ENCRYPTION_KEY env var.
// Exits the process if the key is not set or has an invalid format.
func InitEncryption() {
	keyHex := os.Getenv("ENCRYPTION_KEY")
	if keyHex == "" {
		log.Println("ERROR: ENCRYPTION_KEY 未设置 — 拒绝启动以防止敏感数据明文存储。")
		log.Println("ERROR: 请设置 ENCRYPTION_KEY=<64 位 hex 字符串>（可用 openssl rand -hex 32 生成）。")
		os.Exit(1)
	}
	matched, _ := regexp.MatchString(`^[0-9a-fA-F]{64}$`, keyHex)
	if !matched {
		log.Println("ERROR: ENCRYPTION_KEY 必须是 64 个十六进制字符（32 字节）")
		os.Exit(1)
	}
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		log.Printf("ERROR: ENCRYPTION_KEY 解码失败: %v", err)
		os.Exit(1)
	}
	encryptionKey = key
	log.Println("INFO: 静态加密已启用（AES-256-GCM）")
}

// Encrypt encrypts a plaintext string using AES-256-GCM.
// Returns format: enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>
// If already encrypted (starts with enc:), returns as-is.
func Encrypt(plaintext string) string {
	if encryptionKey == nil || strings.HasPrefix(plaintext, encPrefix) {
		return plaintext
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		log.Printf("ERROR: 创建 cipher 失败: %v", err)
		return plaintext
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		log.Printf("ERROR: 创建 GCM 失败: %v", err)
		return plaintext
	}

	iv := make([]byte, 12) // 96-bit IV for GCM
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		log.Printf("ERROR: 生成 IV 失败: %v", err)
		return plaintext
	}

	// gcm.Seal appends ciphertext+tag (tag is last 16 bytes)
	encrypted := gcm.Seal(nil, iv, []byte(plaintext), nil)
	ciphertext := encrypted[:len(encrypted)-16]
	tag := encrypted[len(encrypted)-16:]

	return fmt.Sprintf("%s%x:%x:%x", encPrefix, iv, tag, ciphertext)
}

// Decrypt decrypts a value encrypted with Encrypt.
// Supports backward-compatible plaintext values (no enc: prefix).
func Decrypt(value string) string {
	if !strings.HasPrefix(value, encPrefix) {
		return value // plaintext, backward compatible
	}
	if encryptionKey == nil {
		log.Println("ERROR: 发现加密数据但 ENCRYPTION_KEY 未设置，无法解密")
		return value
	}

	parts := strings.SplitN(value[len(encPrefix):], ":", 3)
	if len(parts) != 3 {
		log.Println("WARN: 加密值格式不合法，返回原始值")
		return value
	}

	ivBytes, err1 := hex.DecodeString(parts[0])
	tagBytes, err2 := hex.DecodeString(parts[1])
	ctBytes, err3 := hex.DecodeString(parts[2])
	if err1 != nil || err2 != nil || err3 != nil {
		log.Println("WARN: 加密值 hex 解码失败")
		return value
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		log.Printf("ERROR: 创建 cipher 失败: %v", err)
		return value
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		log.Printf("ERROR: 创建 GCM 失败: %v", err)
		return value
	}

	// TS uses createDecipheriv + setAuthTag(tag) + update(ct)
	// Go equivalent: pass ct+tag combined to gcm.Open
	combined := append(ctBytes, tagBytes...) //nolint:gocritic
	plaintext, err := gcm.Open(nil, ivBytes, combined, nil)
	if err != nil {
		log.Printf("ERROR: 解密失败 — 密钥错误或数据损坏: %v", err)
		return value
	}

	return string(plaintext)
}
