package store

import (
	"crypto/subtle"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"copilot-manager/internal/crypto"
)

const (
	maxLogs       = 5000
	debounceDelay = 5 * time.Second
)

// State holds all in-memory application state.
type State struct {
	mu           sync.RWMutex
	accounts     []Account
	keys         []ApiKey
	logs         []RequestLog
	authSessions map[string]AuthSession
	users        []User
	sessions     map[string]UserSession
	systemConfig *SystemConfig
}

var (
	globalState  *State
	dataDir      string
	keysDebounce *debouncedWriter
	logsDebounce *debouncedWriter
)

// Init initializes the store with the given data directory.
// Must be called before any other store functions.
func Init(dir string) {
	dataDir = dir
	globalState = &State{
		authSessions: make(map[string]AuthSession),
		sessions:     make(map[string]UserSession),
	}
	keysDebounce = newDebouncedWriter(debounceDelay, saveKeysNow)
	logsDebounce = newDebouncedWriter(debounceDelay, saveLogsNow)
}

// ─── File I/O ──────────────────────────────────────────────────────────────

func readJSONFile(filename string, v interface{}) error {
	path := filepath.Join(dataDir, filename)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil // file doesn't exist, use zero value
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

func writeJSONFileAtomic(filename string, v interface{}) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(dataDir, filename)
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// ─── Load Store ────────────────────────────────────────────────────────────

// LoadStore loads all data from JSON files into memory.
// Must be called after InitEncryption.
func LoadStore() {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()

	// Load accounts (decrypt github_token)
	var accounts []Account
	if err := readJSONFile("accounts.json", &accounts); err != nil {
		log.Printf("WARN: 加载 accounts.json 失败: %v", err)
	}
	for i := range accounts {
		accounts[i].GithubToken = crypto.Decrypt(accounts[i].GithubToken)
	}
	s.accounts = accounts

	// Load keys (decrypt key field)
	var keys []ApiKey
	if err := readJSONFile("keys.json", &keys); err != nil {
		log.Printf("WARN: 加载 keys.json 失败: %v", err)
	}
	for i := range keys {
		keys[i].Key = crypto.Decrypt(keys[i].Key)
	}
	s.keys = keys

	// Load logs
	var logs []RequestLog
	if err := readJSONFile("logs.json", &logs); err != nil {
		log.Printf("WARN: 加载 logs.json 失败: %v", err)
	}
	s.logs = logs

	// Load users
	var users []User
	if err := readJSONFile("users.json", &users); err != nil {
		log.Printf("WARN: 加载 users.json 失败: %v", err)
	}
	s.users = users

	// Load config
	var config SystemConfig
	if err := readJSONFile("config.json", &config); err != nil {
		log.Printf("WARN: 加载 config.json 失败: %v", err)
	} else if config.Initialized {
		s.systemConfig = &config
	}
}

// ─── Persist ──────────────────────────────────────────────────────────────

func saveAccountsLocked() {
	toSave := make([]Account, len(globalState.accounts))
	for i, a := range globalState.accounts {
		cp := a
		cp.GithubToken = crypto.Encrypt(a.GithubToken)
		toSave[i] = cp
	}
	if err := writeJSONFileAtomic("accounts.json", toSave); err != nil {
		log.Printf("ERROR: 写入 accounts.json 失败: %v", err)
	}
}

func saveKeysNow() {
	globalState.mu.RLock()
	toSave := make([]ApiKey, len(globalState.keys))
	for i, k := range globalState.keys {
		cp := k
		cp.Key = crypto.Encrypt(k.Key)
		toSave[i] = cp
	}
	globalState.mu.RUnlock()
	if err := writeJSONFileAtomic("keys.json", toSave); err != nil {
		log.Printf("ERROR: 写入 keys.json 失败: %v", err)
	}
}

func saveLogsNow() {
	globalState.mu.RLock()
	logs := globalState.logs
	if len(logs) > maxLogs {
		logs = logs[len(logs)-maxLogs:]
	}
	snapshot := make([]RequestLog, len(logs))
	copy(snapshot, logs)
	globalState.mu.RUnlock()
	if err := writeJSONFileAtomic("logs.json", snapshot); err != nil {
		log.Printf("ERROR: 写入 logs.json 失败: %v", err)
	}
}

func saveUsersLocked() {
	if err := writeJSONFileAtomic("users.json", globalState.users); err != nil {
		log.Printf("ERROR: 写入 users.json 失败: %v", err)
	}
}

func saveConfigLocked() {
	if globalState.systemConfig != nil {
		if err := writeJSONFileAtomic("config.json", globalState.systemConfig); err != nil {
			log.Printf("ERROR: 写入 config.json 失败: %v", err)
		}
	}
}

func saveKeysLocked() {
	toSave := make([]ApiKey, len(globalState.keys))
	for i, k := range globalState.keys {
		cp := k
		cp.Key = crypto.Encrypt(k.Key)
		toSave[i] = cp
	}
	if err := writeJSONFileAtomic("keys.json", toSave); err != nil {
		log.Printf("ERROR: 写入 keys.json 失败: %v", err)
	}
}

// FlushPendingWrites flushes all debounced writes immediately (call on shutdown).
func FlushPendingWrites() {
	keysDebounce.Flush()
	logsDebounce.Flush()
}

// ─── Account CRUD ──────────────────────────────────────────────────────────

func GetAccounts(ownerID string) []Account {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()
	if ownerID == "" {
		result := make([]Account, len(s.accounts))
		copy(result, s.accounts)
		return result
	}
	var result []Account
	for _, a := range s.accounts {
		if a.OwnerID == ownerID {
			result = append(result, a)
		}
	}
	return result
}

func GetAccountByID(id, ownerID string) *Account {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, a := range s.accounts {
		if a.ID == id && (ownerID == "" || a.OwnerID == ownerID) {
			cp := a
			return &cp
		}
	}
	return nil
}

func AddAccount(account Account) {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	s.accounts = append(s.accounts, account)
	saveAccountsLocked()
}

func UpdateAccount(id, ownerID string, data map[string]interface{}) *Account {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, a := range s.accounts {
		if a.ID == id && (ownerID == "" || a.OwnerID == ownerID) {
			if v, ok := data["name"].(string); ok && v != "" {
				s.accounts[i].Name = v
			}
			if v, ok := data["github_token"].(string); ok && v != "" {
				s.accounts[i].GithubToken = v
			}
			if v, ok := data["account_type"].(string); ok && v != "" {
				s.accounts[i].AccountType = AccountType(v)
			}
			if v, ok := data["api_url"].(string); ok && v != "" {
				s.accounts[i].APIURL = v
			}
			saveAccountsLocked()
			cp := s.accounts[i]
			return &cp
		}
	}
	return nil
}

func DeleteAccount(id, ownerID string) bool {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	before := len(s.accounts)
	newAccounts := s.accounts[:0]
	for _, a := range s.accounts {
		if a.ID == id {
			if ownerID != "" && a.OwnerID != ownerID {
				newAccounts = append(newAccounts, a)
				continue
			}
			continue // delete
		}
		newAccounts = append(newAccounts, a)
	}
	s.accounts = newAccounts
	if len(s.accounts) < before {
		saveAccountsLocked()
		return true
	}
	return false
}

// ─── ApiKey CRUD ───────────────────────────────────────────────────────────

func GetKeys(ownerID, accountID string) []ApiKey {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []ApiKey
	for _, k := range s.keys {
		if ownerID != "" && k.OwnerID != ownerID {
			continue
		}
		if accountID != "" && k.AccountID != accountID {
			continue
		}
		result = append(result, k)
	}
	return result
}

func GetKeyByID(id, ownerID string) *ApiKey {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, k := range s.keys {
		if k.ID == id && (ownerID == "" || k.OwnerID == ownerID) {
			cp := k
			return &cp
		}
	}
	return nil
}

func AddKey(key ApiKey) {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	s.keys = append(s.keys, key)
	saveKeysLocked()
}

func UpdateKey(id, ownerID string, data map[string]interface{}) *ApiKey {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, k := range s.keys {
		if k.ID == id && (ownerID == "" || k.OwnerID == ownerID) {
			if v, ok := data["name"].(string); ok && v != "" {
				s.keys[i].Name = v
			}
			if v, ok := data["key"].(string); ok && v != "" {
				s.keys[i].Key = v
			}
			if v, ok := data["enabled"]; ok {
				if b, ok := v.(bool); ok {
					s.keys[i].Enabled = b
				}
			}
			saveKeysLocked()
			cp := s.keys[i]
			return &cp
		}
	}
	return nil
}

func DeleteKey(id, ownerID string) bool {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	before := len(s.keys)
	newKeys := s.keys[:0]
	for _, k := range s.keys {
		if k.ID == id {
			if ownerID != "" && k.OwnerID != ownerID {
				newKeys = append(newKeys, k)
				continue
			}
			continue // delete
		}
		newKeys = append(newKeys, k)
	}
	s.keys = newKeys
	if len(s.keys) < before {
		saveKeysLocked()
		return true
	}
	return false
}

// FindKeyWithAccount finds an API key by value (timing-safe) and its associated account.
func FindKeyWithAccount(apiKey string) (*ApiKey, *Account) {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()
	inputBuf := []byte(apiKey)
	for _, k := range s.keys {
		if !k.Enabled {
			continue
		}
		storedBuf := []byte(k.Key)
		if len(inputBuf) != len(storedBuf) {
			continue
		}
		if subtle.ConstantTimeCompare(inputBuf, storedBuf) == 1 {
			kCopy := k
			for _, a := range s.accounts {
				if a.ID == k.AccountID {
					aCopy := a
					return &kCopy, &aCopy
				}
			}
			return &kCopy, nil
		}
	}
	return nil, nil
}

// ─── Logs ──────────────────────────────────────────────────────────────────

type LogsResult struct {
	Logs  []RequestLog
	Total int
}

func GetLogs(page, limit int, accountID, apiKeyID string) LogsResult {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()

	var filtered []RequestLog
	for _, l := range s.logs {
		if accountID != "" && l.AccountID != accountID {
			continue
		}
		if apiKeyID != "" && l.ApiKeyID != apiKeyID {
			continue
		}
		filtered = append(filtered, l)
	}

	// Reverse (newest first)
	n := len(filtered)
	reversed := make([]RequestLog, n)
	for i, l := range filtered {
		reversed[n-1-i] = l
	}

	total := len(reversed)
	if limit <= 0 {
		limit = 50
	}
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * limit
	if offset >= total {
		return LogsResult{Logs: []RequestLog{}, Total: total}
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return LogsResult{Logs: reversed[offset:end], Total: total}
}

func AppendLog(l RequestLog) {
	s := globalState
	s.mu.Lock()
	s.logs = append(s.logs, l)
	if len(s.logs) > maxLogs {
		s.logs = s.logs[len(s.logs)-maxLogs:]
	}
	s.mu.Unlock()
	logsDebounce.Schedule()
}

func IncrementKeyRequestCount(keyID string) {
	s := globalState
	s.mu.Lock()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for i, k := range s.keys {
		if k.ID == keyID {
			s.keys[i].RequestCount++
			s.keys[i].LastUsedAt = &now
			break
		}
	}
	s.mu.Unlock()
	keysDebounce.Schedule()
}

// ─── Stats ────────────────────────────────────────────────────────────────

type Stats struct {
	TotalAccounts int `json:"total_accounts"`
	EnabledKeys   int `json:"enabled_keys"`
	TodayRequests int `json:"today_requests"`
	TotalRequests int `json:"total_requests"`
}

func GetStats() Stats {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()

	today := time.Now().UTC().Format("2006-01-02")
	todayCount := 0
	for _, l := range s.logs {
		if len(l.CreatedAt) >= 10 && l.CreatedAt[:10] == today {
			todayCount++
		}
	}
	enabledKeys := 0
	for _, k := range s.keys {
		if k.Enabled {
			enabledKeys++
		}
	}
	return Stats{
		TotalAccounts: len(s.accounts),
		EnabledKeys:   enabledKeys,
		TodayRequests: todayCount,
		TotalRequests: len(s.logs),
	}
}

// ─── Auth Sessions (Device Flow) ──────────────────────────────────────────

func SetAuthSession(session AuthSession) {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authSessions[session.AuthID] = session
}

func GetAuthSession(authID string) *AuthSession {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()
	if session, ok := s.authSessions[authID]; ok {
		cp := session
		return &cp
	}
	return nil
}

func DeleteAuthSession(authID string) {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.authSessions, authID)
}

// ─── User CRUD ─────────────────────────────────────────────────────────────

func GetUsers() []User {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]User, len(s.users))
	copy(result, s.users)
	return result
}

func GetUserByID(id string) *User {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.users {
		if u.ID == id {
			cp := u
			return &cp
		}
	}
	return nil
}

func GetUserByUsername(username string) *User {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.users {
		if u.Username == username {
			cp := u
			return &cp
		}
	}
	return nil
}

func AddUser(user User) {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users = append(s.users, user)
	saveUsersLocked()
}

func UpdateUser(id string, data map[string]interface{}) *User {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, u := range s.users {
		if u.ID == id {
			if v, ok := data["username"].(string); ok && v != "" {
				s.users[i].Username = v
			}
			if v, ok := data["password_hash"].(string); ok && v != "" {
				s.users[i].PasswordHash = v
			}
			if v, ok := data["role"].(string); ok && v != "" {
				s.users[i].Role = UserRole(v)
			}
			if v, ok := data["last_login_at"]; ok {
				if ts, ok := v.(string); ok {
					tsCopy := ts
					s.users[i].LastLoginAt = &tsCopy
				}
			}
			saveUsersLocked()
			cp := s.users[i]
			return &cp
		}
	}
	return nil
}

func DeleteUser(id string) bool {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	before := len(s.users)
	newUsers := s.users[:0]
	for _, u := range s.users {
		if u.ID != id {
			newUsers = append(newUsers, u)
		}
	}
	s.users = newUsers
	if len(s.users) < before {
		saveUsersLocked()
		return true
	}
	return false
}

// ─── Session Management ────────────────────────────────────────────────────

func SetSession(session UserSession) {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[session.SessionID] = session
}

func GetSession(sessionID string) *UserSession {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()
	if session, ok := s.sessions[sessionID]; ok {
		cp := session
		return &cp
	}
	return nil
}

func DeleteSession(sessionID string) {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, sessionID)
}

// ─── System Config ─────────────────────────────────────────────────────────

func GetSystemConfig() *SystemConfig {
	s := globalState
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.systemConfig == nil {
		return nil
	}
	cp := *s.systemConfig
	return &cp
}

func SetSystemConfig(config SystemConfig) {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	s.systemConfig = &config
	saveConfigLocked()
}

func UpdateSystemConfig(initialized bool, adminCreatedAt string) {
	s := globalState
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.systemConfig != nil {
		s.systemConfig.Initialized = initialized
		if adminCreatedAt != "" {
			s.systemConfig.AdminCreatedAt = adminCreatedAt
		}
		saveConfigLocked()
	}
}
