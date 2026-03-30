package store

import (
	"crypto/subtle"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"gorm.io/gorm"
)

const maxLogs = 5000

// keyCacheEntry is used for timing-safe API key lookups in the hot path.
type keyCacheEntry struct {
	keyID   string
	keyVal  string // plaintext
	enabled bool
}

// State holds all application state.
type State struct {
	mu           sync.RWMutex
	db           *gorm.DB
	authSessions map[string]AuthSession
	sessions     map[string]UserSession
	keyCache     []keyCacheEntry
	logCount     atomic.Int64
}

var (
	globalState *State
	dataDir     string
)

// ─── Init / Load / Flush ─────────────────────────────────────────────────────

// Init initializes the store with the given data directory.
// Must be called before any other store functions.
func Init(dir string) {
	dataDir = dir
	globalState = &State{
		authSessions: make(map[string]AuthSession),
		sessions:     make(map[string]UserSession),
	}
}

// LoadStore opens the SQLite database, creates tables, and preloads the key cache.
// Must be called after InitEncryption.
func LoadStore() {
	s := globalState
	db, err := openDB(dataDir)
	if err != nil {
		log.Fatalf("FATAL: 初始化数据库失败: %v", err)
	}
	if err := execMigrate(db); err != nil {
		log.Fatalf("FATAL: 建表失败: %v", err)
	}
	s.mu.Lock()
	s.db = db
	s.mu.Unlock()

	rebuildKeyCache()

	var count int64
	db.Model(&RequestLog{}).Count(&count)
	s.logCount.Store(count)
}

// FlushPendingWrites performs a WAL checkpoint (called on shutdown).
func FlushPendingWrites() {
	s := globalState
	if s == nil || s.db == nil {
		return
	}
	if err := s.db.Exec("PRAGMA wal_checkpoint(PASSIVE)").Error; err != nil {
		log.Printf("WARN: WAL checkpoint 失败: %v", err)
	}
}

// rebuildKeyCache reloads the in-memory plaintext key cache from the DB.
func rebuildKeyCache() {
	s := globalState
	var keys []ApiKey
	if err := s.db.Select("id, key, enabled").Find(&keys).Error; err != nil {
		log.Printf("WARN: 预加载 keyCache 失败: %v", err)
		return
	}
	cache := make([]keyCacheEntry, 0, len(keys))
	for _, k := range keys {
		cache = append(cache, keyCacheEntry{keyID: k.ID, keyVal: k.Key, enabled: k.Enabled})
	}
	s.mu.Lock()
	s.keyCache = cache
	s.mu.Unlock()
}

// ─── Account CRUD ─────────────────────────────────────────────────────────────

func GetAccounts(ownerID string) []Account {
	s := globalState
	var result []Account
	q := s.db.Order("created_at ASC")
	if ownerID != "" {
		q = q.Where("owner_id = ?", ownerID)
	}
	if err := q.Find(&result).Error; err != nil {
		log.Printf("ERROR: 查询账号失败: %v", err)
		return nil
	}
	return result
}

func GetAccountByID(id, ownerID string) *Account {
	s := globalState
	var a Account
	q := s.db.Where("id = ?", id)
	if ownerID != "" {
		q = q.Where("owner_id = ?", ownerID)
	}
	if err := q.First(&a).Error; err != nil {
		return nil
	}
	return &a
}

func AddAccount(account Account) {
	s := globalState
	if err := s.db.Create(&account).Error; err != nil {
		log.Printf("ERROR: 插入账号失败: %v", err)
	}
}

func UpdateAccount(id, ownerID string, data map[string]interface{}) *Account {
	a := GetAccountByID(id, ownerID)
	if a == nil {
		return nil
	}
	if v, ok := data["name"].(string); ok && v != "" {
		a.Name = v
	}
	if v, ok := data["github_token"].(string); ok && v != "" {
		a.GithubToken = v
	}
	if v, ok := data["account_type"].(string); ok && v != "" {
		a.AccountType = AccountType(v)
	}
	if v, ok := data["api_url"].(string); ok && v != "" {
		a.APIURL = v
	}
	s := globalState
	if err := s.db.Save(a).Error; err != nil {
		log.Printf("ERROR: 更新账号失败: %v", err)
		return nil
	}
	return a
}

func DeleteAccount(id, ownerID string) bool {
	s := globalState
	q := s.db.Where("id = ?", id)
	if ownerID != "" {
		q = q.Where("owner_id = ?", ownerID)
	}
	result := q.Delete(&Account{})
	return result.RowsAffected > 0
}

// ─── ApiKey CRUD ──────────────────────────────────────────────────────────────

func GetKeys(ownerID, accountID string) []ApiKey {
	s := globalState
	var result []ApiKey
	q := s.db.Order("created_at ASC")
	if ownerID != "" {
		q = q.Where("owner_id = ?", ownerID)
	}
	if accountID != "" {
		q = q.Where("account_id = ?", accountID)
	}
	if err := q.Find(&result).Error; err != nil {
		log.Printf("ERROR: 查询 API 密钥失败: %v", err)
		return nil
	}
	return result
}

func GetKeyByID(id, ownerID string) *ApiKey {
	s := globalState
	var k ApiKey
	q := s.db.Where("id = ?", id)
	if ownerID != "" {
		q = q.Where("owner_id = ?", ownerID)
	}
	if err := q.First(&k).Error; err != nil {
		return nil
	}
	return &k
}

func AddKey(key ApiKey) {
	s := globalState
	if err := s.db.Create(&key).Error; err != nil {
		log.Printf("ERROR: 插入 API 密钥失败: %v", err)
		return
	}
	s.mu.Lock()
	s.keyCache = append(s.keyCache, keyCacheEntry{keyID: key.ID, keyVal: key.Key, enabled: key.Enabled})
	s.mu.Unlock()
}

func UpdateKey(id, ownerID string, data map[string]interface{}) *ApiKey {
	k := GetKeyByID(id, ownerID)
	if k == nil {
		return nil
	}
	if v, ok := data["name"].(string); ok && v != "" {
		k.Name = v
	}
	if v, ok := data["key"].(string); ok && v != "" {
		k.Key = v
	}
	if v, ok := data["enabled"]; ok {
		if b, ok := v.(bool); ok {
			k.Enabled = b
		}
	}
	s := globalState
	if err := s.db.Save(k).Error; err != nil {
		log.Printf("ERROR: 更新 API 密钥失败: %v", err)
		return nil
	}
	s.mu.Lock()
	for i, entry := range s.keyCache {
		if entry.keyID == id {
			s.keyCache[i].keyVal = k.Key
			s.keyCache[i].enabled = k.Enabled
			break
		}
	}
	s.mu.Unlock()
	return k
}

func DeleteKey(id, ownerID string) bool {
	s := globalState
	q := s.db.Where("id = ?", id)
	if ownerID != "" {
		q = q.Where("owner_id = ?", ownerID)
	}
	result := q.Delete(&ApiKey{})
	if result.RowsAffected == 0 {
		return false
	}
	s.mu.Lock()
	newCache := s.keyCache[:0]
	for _, entry := range s.keyCache {
		if entry.keyID != id {
			newCache = append(newCache, entry)
		}
	}
	s.keyCache = newCache
	s.mu.Unlock()
	return true
}

// FindKeyWithAccount finds an API key by value (timing-safe) and its associated account.
// Hot path: keyCache lookup (RLock) → DB fetch on match.
func FindKeyWithAccount(apiKey string) (*ApiKey, *Account) {
	s := globalState
	inputBuf := []byte(apiKey)

	s.mu.RLock()
	var matchedID string
	for _, entry := range s.keyCache {
		if !entry.enabled {
			continue
		}
		storedBuf := []byte(entry.keyVal)
		if len(inputBuf) != len(storedBuf) {
			continue
		}
		if subtle.ConstantTimeCompare(inputBuf, storedBuf) == 1 {
			matchedID = entry.keyID
			break
		}
	}
	s.mu.RUnlock()

	if matchedID == "" {
		return nil, nil
	}
	k := GetKeyByID(matchedID, "")
	if k == nil {
		return nil, nil
	}
	a := GetAccountByID(k.AccountID, "")
	return k, a
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

// LogsResult holds a paginated log query result.
type LogsResult struct {
	Logs  []RequestLog
	Total int
}

func GetLogs(page, limit int, accountID, apiKeyID string) LogsResult {
	s := globalState
	if limit <= 0 {
		limit = 50
	}
	if page <= 0 {
		page = 1
	}

	applyFilters := func(q *gorm.DB) *gorm.DB {
		if accountID != "" {
			q = q.Where("account_id = ?", accountID)
		}
		if apiKeyID != "" {
			q = q.Where("api_key_id = ?", apiKeyID)
		}
		return q
	}

	var total int64
	applyFilters(s.db.Model(&RequestLog{})).Count(&total)

	var logs []RequestLog
	applyFilters(s.db.Model(&RequestLog{})).
		Order("created_at DESC").Limit(limit).Offset((page-1)*limit).Find(&logs)
	if logs == nil {
		logs = []RequestLog{}
	}
	return LogsResult{Logs: logs, Total: int(total)}
}

func AppendLog(l RequestLog) {
	s := globalState
	if err := s.db.Create(&l).Error; err != nil {
		log.Printf("ERROR: 插入日志失败: %v", err)
		return
	}
	// Trim every 50 inserts: keep newest maxLogs rows.
	if s.logCount.Add(1)%50 == 0 {
		s.db.Exec(
			`DELETE FROM request_logs WHERE rowid NOT IN (SELECT rowid FROM request_logs ORDER BY created_at DESC LIMIT ?)`,
			maxLogs,
		)
	}
}

func IncrementKeyRequestCount(keyID string) {
	s := globalState
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := s.db.Model(&ApiKey{}).Where("id = ?", keyID).
		Updates(map[string]interface{}{"request_count": gorm.Expr("request_count + 1"), "last_used_at": now}).Error; err != nil {
		log.Printf("WARN: 更新请求计数失败: %v", err)
	}
}

// ─── Stats ────────────────────────────────────────────────────────────────────

// Stats holds dashboard summary counters.
type Stats struct {
	TotalAccounts int `json:"total_accounts"`
	EnabledKeys   int `json:"enabled_keys"`
	TodayRequests int `json:"today_requests"`
	TotalRequests int `json:"total_requests"`
}

func GetStats() Stats {
	s := globalState
	var stats Stats

	var totalAccounts, enabledKeys, totalRequests, todayRequests int64
	s.db.Model(&Account{}).Count(&totalAccounts)
	s.db.Model(&ApiKey{}).Where("enabled = ?", true).Count(&enabledKeys)
	s.db.Model(&RequestLog{}).Count(&totalRequests)

	today := time.Now().UTC().Format("2006-01-02")
	tomorrow := time.Now().UTC().AddDate(0, 0, 1).Format("2006-01-02")
	s.db.Model(&RequestLog{}).Where("created_at >= ? AND created_at < ?", today+"T00:00:00Z", tomorrow+"T00:00:00Z").Count(&todayRequests)

	stats.TotalAccounts = int(totalAccounts)
	stats.EnabledKeys = int(enabledKeys)
	stats.TotalRequests = int(totalRequests)
	stats.TodayRequests = int(todayRequests)
	return stats
}

// ─── Auth Sessions (Device Flow) ─────────────────────────────────────────────

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

// ─── User CRUD ────────────────────────────────────────────────────────────────

func GetUsers() []User {
	s := globalState
	var result []User
	if err := s.db.Order("created_at ASC").Find(&result).Error; err != nil {
		log.Printf("ERROR: 查询用户失败: %v", err)
		return nil
	}
	return result
}

func GetUserByID(id string) *User {
	s := globalState
	var u User
	if err := s.db.Where("id = ?", id).First(&u).Error; err != nil {
		return nil
	}
	return &u
}

func GetUserByUsername(username string) *User {
	s := globalState
	var u User
	if err := s.db.Where("username = ?", username).First(&u).Error; err != nil {
		return nil
	}
	return &u
}

func AddUser(user User) {
	s := globalState
	if err := s.db.Create(&user).Error; err != nil {
		log.Printf("ERROR: 插入用户失败: %v", err)
	}
}

func UpdateUser(id string, data map[string]interface{}) *User {
	u := GetUserByID(id)
	if u == nil {
		return nil
	}
	if v, ok := data["username"].(string); ok && v != "" {
		u.Username = v
	}
	if v, ok := data["password_hash"].(string); ok && v != "" {
		u.PasswordHash = v
	}
	if v, ok := data["role"].(string); ok && v != "" {
		u.Role = UserRole(v)
	}
	if v, ok := data["last_login_at"]; ok {
		if ts, ok := v.(string); ok {
			tsCopy := ts
			u.LastLoginAt = &tsCopy
		}
	}
	s := globalState
	if err := s.db.Save(u).Error; err != nil {
		log.Printf("ERROR: 更新用户失败: %v", err)
		return nil
	}
	return u
}

func DeleteUser(id string) bool {
	s := globalState
	result := s.db.Where("id = ?", id).Delete(&User{})
	return result.RowsAffected > 0
}

// ─── Session Management ───────────────────────────────────────────────────────

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

// ─── System Config ────────────────────────────────────────────────────────────

// GetSystemConfig returns the system config, or nil if not yet initialized.
func GetSystemConfig() *SystemConfig {
	s := globalState
	var config SystemConfig
	if err := s.db.First(&config, 1).Error; err != nil {
		return nil
	}
	if !config.Initialized {
		return nil
	}
	return &config
}

func SetSystemConfig(config SystemConfig) {
	s := globalState
	config.ID = 1
	if err := s.db.Save(&config).Error; err != nil {
		log.Printf("ERROR: 更新系统配置失败: %v", err)
	}
}

func UpdateSystemConfig(initialized bool, adminCreatedAt string) {
	config := GetSystemConfig()
	if config == nil {
		return
	}
	config.Initialized = initialized
	if adminCreatedAt != "" {
		config.AdminCreatedAt = adminCreatedAt
	}
	SetSystemConfig(*config)
}
