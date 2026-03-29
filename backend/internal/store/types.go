package store

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
	ID           string   `json:"id"`
	Username     string   `json:"username"`
	PasswordHash string   `json:"password_hash"`
	Role         UserRole `json:"role"`
	CreatedAt    string   `json:"created_at"`
	CreatedBy    *string  `json:"created_by"`
	LastLoginAt  *string  `json:"last_login_at"`
}

// UserSession represents an active user session.
type UserSession struct {
	SessionID string `json:"session_id"`
	UserID    string `json:"user_id"`
	CreatedAt string `json:"created_at"`
	ExpiresAt string `json:"expires_at"`
}

// Account represents a GitHub Copilot account.
type Account struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	GithubToken string      `json:"github_token"`
	AccountType AccountType `json:"account_type"`
	APIURL      string      `json:"api_url"`
	OwnerID     string      `json:"owner_id"`
	CreatedAt   string      `json:"created_at"`
}

// ApiKey represents an API key for accessing the proxy.
type ApiKey struct {
	ID           string  `json:"id"`
	Key          string  `json:"key"`
	Name         string  `json:"name"`
	AccountID    string  `json:"account_id"`
	OwnerID      string  `json:"owner_id"`
	Enabled      bool    `json:"enabled"`
	RequestCount int64   `json:"request_count"`
	LastUsedAt   *string `json:"last_used_at"`
	CreatedAt    string  `json:"created_at"`
}

// RequestLog represents a logged proxy request.
type RequestLog struct {
	ID         string  `json:"id"`
	ApiKeyID   string  `json:"api_key_id"`
	AccountID  string  `json:"account_id"`
	ApiKeyName string  `json:"api_key_name"`
	AccountName string `json:"account_name"`
	Method     string  `json:"method"`
	Path       string  `json:"path"`
	StatusCode int     `json:"status_code"`
	DurationMs int64   `json:"duration_ms"`
	Model      *string `json:"model"`
	Error      *string `json:"error"`
	CreatedAt  string  `json:"created_at"`
}

// AuthSession represents a GitHub Device Flow authentication session.
type AuthSession struct {
	AuthID      string      `json:"auth_id"`
	DeviceCode  string      `json:"device_code"`
	Name        string      `json:"name"`
	AccountType AccountType `json:"account_type"`
	APIURL      string      `json:"api_url"`
	OwnerID     string      `json:"owner_id"`
	Interval    int         `json:"interval"`
	StartedAt   string      `json:"started_at"`
	ExpiresAt   string      `json:"expires_at"`
}

// SystemConfig stores the system initialization state.
type SystemConfig struct {
	Initialized    bool   `json:"initialized"`
	AdminCreatedAt string `json:"admin_created_at"`
}
