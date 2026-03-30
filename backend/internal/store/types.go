package store

import (
	"strings"

	"copilot-manager/internal/crypto"
	"gorm.io/gorm"
)

// UserRole represents the role of a user.
type UserRole string

const (
	RoleAdmin UserRole = "admin"
	RoleUser  UserRole = "user"
)

// AccountType represents the type of a GitHub Copilot account.
type AccountType string

const (
	AccountIndividual  AccountType = "individual"
	AccountBusiness    AccountType = "business"
	AccountEnterprise  AccountType = "enterprise"
)

// User represents an application user.
type User struct {
	ID           string   `gorm:"primaryKey" json:"id"`
	Username     string   `gorm:"uniqueIndex;not null" json:"username"`
	PasswordHash string   `gorm:"not null" json:"password_hash"`
	Role         UserRole `gorm:"not null;default:user" json:"role"`
	CreatedAt    string   `gorm:"not null" json:"created_at"`
	CreatedBy    *string  `json:"created_by"`
	LastLoginAt  *string  `json:"last_login_at"`
}

// UserSession represents an active user session (in-memory only).
type UserSession struct {
	SessionID string `json:"session_id"`
	UserID    string `json:"user_id"`
	CreatedAt string `json:"created_at"`
	ExpiresAt string `json:"expires_at"`
}

// Account represents a GitHub Copilot account.
type Account struct {
	ID          string      `gorm:"primaryKey" json:"id"`
	Name        string      `gorm:"not null" json:"name"`
	GithubToken string      `gorm:"not null" json:"github_token"`
	AccountType AccountType `gorm:"not null;default:individual" json:"account_type"`
	APIURL      string      `gorm:"column:api_url;not null" json:"api_url"`
	OwnerID     string      `gorm:"not null;index" json:"owner_id"`
	CreatedAt   string      `gorm:"not null" json:"created_at"`
}

func (Account) TableName() string { return "accounts" }

// BeforeSave encrypts GithubToken before writing to DB.
func (a *Account) BeforeSave(*gorm.DB) error {
	if a.GithubToken != "" && !strings.HasPrefix(a.GithubToken, "enc:") {
		a.GithubToken = crypto.Encrypt(a.GithubToken)
	}
	return nil
}

// AfterFind decrypts GithubToken after reading from DB.
func (a *Account) AfterFind(*gorm.DB) error {
	if a.GithubToken != "" && strings.HasPrefix(a.GithubToken, "enc:") {
		a.GithubToken = crypto.Decrypt(a.GithubToken)
	}
	return nil
}

// AfterSave decrypts GithubToken back after save (so in-memory struct stays plaintext).
func (a *Account) AfterSave(*gorm.DB) error { return a.AfterFind(nil) }

// ApiKey represents an API key for accessing the proxy.
type ApiKey struct {
	ID           string  `gorm:"primaryKey" json:"id"`
	Key          string  `gorm:"not null" json:"key"`
	Name         string  `gorm:"not null" json:"name"`
	AccountID    string  `gorm:"not null;index" json:"account_id"`
	OwnerID      string  `gorm:"not null;index" json:"owner_id"`
	Enabled      bool    `gorm:"not null;default:true" json:"enabled"`
	RequestCount int64   `gorm:"not null;default:0" json:"request_count"`
	LastUsedAt   *string `json:"last_used_at"`
	CreatedAt    string  `gorm:"not null" json:"created_at"`
}

func (ApiKey) TableName() string { return "api_keys" }

// BeforeSave encrypts Key before writing to DB.
func (k *ApiKey) BeforeSave(*gorm.DB) error {
	if k.Key != "" && !strings.HasPrefix(k.Key, "enc:") {
		k.Key = crypto.Encrypt(k.Key)
	}
	return nil
}

// AfterFind decrypts Key after reading from DB.
func (k *ApiKey) AfterFind(*gorm.DB) error {
	if k.Key != "" && strings.HasPrefix(k.Key, "enc:") {
		k.Key = crypto.Decrypt(k.Key)
	}
	return nil
}

// AfterSave decrypts Key back after save (so in-memory struct stays plaintext).
func (k *ApiKey) AfterSave(*gorm.DB) error { return k.AfterFind(nil) }

// RequestLog represents a logged proxy request.
type RequestLog struct {
	ID               string  `gorm:"primaryKey" json:"id"`
	ApiKeyID         string  `gorm:"not null;index" json:"api_key_id"`
	AccountID        string  `gorm:"not null;index" json:"account_id"`
	ApiKeyName       string  `gorm:"not null" json:"api_key_name"`
	AccountName      string  `gorm:"not null" json:"account_name"`
	Method           string  `gorm:"not null" json:"method"`
	Path             string  `gorm:"not null" json:"path"`
	StatusCode       int     `gorm:"not null" json:"status_code"`
	DurationMs       int64   `gorm:"not null" json:"duration_ms"`
	Model            *string `json:"model"`
	Error            *string `json:"error"`
	PromptTokens     *int64  `json:"prompt_tokens"`
	CompletionTokens *int64  `json:"completion_tokens"`
	TotalTokens      *int64  `json:"total_tokens"`
	FirstTokenMs     *int64  `json:"first_token_ms"`
	CreatedAt        string  `gorm:"not null;index" json:"created_at"`
}

func (RequestLog) TableName() string { return "request_logs" }

// AuthSession represents a GitHub Device Flow authentication session (in-memory only).
type AuthSession struct {
	AuthID      string      `json:"auth_id"`
	DeviceCode  string      `json:"device_code"`
	Name        string      `json:"name"`
	AccountType AccountType  `json:"account_type"`
	APIURL      string      `json:"api_url"`
	OwnerID     string      `json:"owner_id"`
	Interval    int         `json:"interval"`
	StartedAt   string      `json:"started_at"`
	ExpiresAt   string      `json:"expires_at"`
}

// SystemConfig stores the system initialization state.
type SystemConfig struct {
	ID            int    `gorm:"primaryKey;autoIncrement:false" json:"-"`
	Initialized   bool   `gorm:"not null;default:false" json:"initialized"`
	AdminCreatedAt string `gorm:"not null;default:''" json:"admin_created_at"`
}

func (SystemConfig) TableName() string { return "system_config" }
