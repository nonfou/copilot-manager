package store

import (
	"crypto/subtle"
	"database/sql"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"copilot-manager/internal/crypto"
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
	db           *sql.DB
	authSessions map[string]AuthSession
	sessions     map[string]UserSession
	keyCache     []keyCacheEntry
	logCount     atomic.Int64
}

var (
	globalState *State
	dataDir     string
)

// scanner is implemented by both *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...interface{}) error
}

// ─── Scan Helpers ────────────────────────────────────────────────────────────

func scanUserRow(s scanner) (User, error) {
	var u User
	var roleStr string
	var createdBy, lastLoginAt sql.NullString
	err := s.Scan(&u.ID, &u.Username, &u.PasswordHash, &roleStr, &u.CreatedAt, &createdBy, &lastLoginAt)
	if err != nil {
		return User{}, err
	}
	u.Role = UserRole(roleStr)
	if createdBy.Valid {
		v := createdBy.String
		u.CreatedBy = &v
	}
	if lastLoginAt.Valid {
		v := lastLoginAt.String
		u.LastLoginAt = &v
	}
	return u, nil
}

func scanAccountRow(s scanner) (Account, error) {
	var a Account
	var encToken, accountTypeStr string
	err := s.Scan(&a.ID, &a.Name, &encToken, &accountTypeStr, &a.APIURL, &a.OwnerID, &a.CreatedAt)
	if err != nil {
		return Account{}, err
	}
	a.GithubToken = crypto.Decrypt(encToken)
	a.AccountType = AccountType(accountTypeStr)
	return a, nil
}

func scanApiKeyRow(s scanner) (ApiKey, error) {
	var k ApiKey
	var encKey string
	var enabledInt int
	var lastUsedAt sql.NullString
	err := s.Scan(&k.ID, &encKey, &k.Name, &k.AccountID, &k.OwnerID, &enabledInt, &k.RequestCount, &lastUsedAt, &k.CreatedAt)
	if err != nil {
		return ApiKey{}, err
	}
	k.Key = crypto.Decrypt(encKey)
	k.Enabled = enabledInt != 0
	if lastUsedAt.Valid {
		v := lastUsedAt.String
		k.LastUsedAt = &v
	}
	return k, nil
}

func scanRequestLogRow(s scanner) (RequestLog, error) {
	var l RequestLog
	var model, errMsg sql.NullString
	err := s.Scan(&l.ID, &l.ApiKeyID, &l.AccountID, &l.ApiKeyName, &l.AccountName,
		&l.Method, &l.Path, &l.StatusCode, &l.DurationMs, &model, &errMsg, &l.CreatedAt)
	if err != nil {
		return RequestLog{}, err
	}
	if model.Valid {
		v := model.String
		l.Model = &v
	}
	if errMsg.Valid {
		v := errMsg.String
		l.Error = &v
	}
	return l, nil
}

// nullString converts *string to an interface{} suitable for SQL (nil → NULL).
func nullString(s *string) interface{} {
	if s == nil {
		return nil
	}
	return *s
}

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
	if err := execSchema(db); err != nil {
		log.Fatalf("FATAL: 建表失败: %v", err)
	}
	s.mu.Lock()
	s.db = db
	s.mu.Unlock()

	rebuildKeyCache()

	var count int64
	if err := db.QueryRow("SELECT COUNT(*) FROM request_logs").Scan(&count); err != nil {
		log.Printf("WARN: 获取日志计数失败: %v", err)
	}
	s.logCount.Store(count)
}

// FlushPendingWrites performs a WAL checkpoint (called on shutdown).
// Signature is kept identical to the JSON-based implementation.
func FlushPendingWrites() {
	s := globalState
	if s == nil || s.db == nil {
		return
	}
	if _, err := s.db.Exec("PRAGMA wal_checkpoint(PASSIVE)"); err != nil {
		log.Printf("WARN: WAL checkpoint 失败: %v", err)
	}
}

// rebuildKeyCache reloads the in-memory plaintext key cache from the DB.
func rebuildKeyCache() {
	s := globalState
	rows, err := s.db.Query("SELECT id, key, enabled FROM api_keys")
	if err != nil {
		log.Printf("WARN: 预加载 keyCache 失败: %v", err)
		return
	}
	defer rows.Close()

	var cache []keyCacheEntry
	for rows.Next() {
		var entry keyCacheEntry
		var encKey string
		var enabledInt int
		if err := rows.Scan(&entry.keyID, &encKey, &enabledInt); err != nil {
			continue
		}
		entry.keyVal = crypto.Decrypt(encKey)
		entry.enabled = enabledInt != 0
		cache = append(cache, entry)
	}
	s.mu.Lock()
	s.keyCache = cache
	s.mu.Unlock()
}

// ─── Account CRUD ─────────────────────────────────────────────────────────────

func GetAccounts(ownerID string) []Account {
	s := globalState
	var rows *sql.Rows
	var err error
	const q = `SELECT id, name, github_token, account_type, api_url, owner_id, created_at FROM accounts`
	if ownerID == "" {
		rows, err = s.db.Query(q + " ORDER BY created_at ASC")
	} else {
		rows, err = s.db.Query(q+" WHERE owner_id=? ORDER BY created_at ASC", ownerID)
	}
	if err != nil {
		log.Printf("ERROR: 查询账号失败: %v", err)
		return nil
	}
	defer rows.Close()

	var result []Account
	for rows.Next() {
		a, err := scanAccountRow(rows)
		if err != nil {
			log.Printf("WARN: 扫描账号行失败: %v", err)
			continue
		}
		result = append(result, a)
	}
	return result
}

func GetAccountByID(id, ownerID string) *Account {
	s := globalState
	const q = `SELECT id, name, github_token, account_type, api_url, owner_id, created_at FROM accounts WHERE id=?`
	var row *sql.Row
	if ownerID == "" {
		row = s.db.QueryRow(q, id)
	} else {
		row = s.db.QueryRow(q+" AND owner_id=?", id, ownerID)
	}
	a, err := scanAccountRow(row)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		log.Printf("ERROR: 查询账号失败: %v", err)
		return nil
	}
	return &a
}

func AddAccount(account Account) {
	s := globalState
	encToken := crypto.Encrypt(account.GithubToken)
	_, err := s.db.Exec(
		`INSERT INTO accounts (id, name, github_token, account_type, api_url, owner_id, created_at) VALUES (?,?,?,?,?,?,?)`,
		account.ID, account.Name, encToken, string(account.AccountType), account.APIURL, account.OwnerID, account.CreatedAt,
	)
	if err != nil {
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
	encToken := crypto.Encrypt(a.GithubToken)
	_, err := s.db.Exec(
		`UPDATE accounts SET name=?, github_token=?, account_type=?, api_url=? WHERE id=?`,
		a.Name, encToken, string(a.AccountType), a.APIURL, id,
	)
	if err != nil {
		log.Printf("ERROR: 更新账号失败: %v", err)
		return nil
	}
	return a
}

func DeleteAccount(id, ownerID string) bool {
	s := globalState
	var res sql.Result
	var err error
	if ownerID == "" {
		res, err = s.db.Exec(`DELETE FROM accounts WHERE id=?`, id)
	} else {
		res, err = s.db.Exec(`DELETE FROM accounts WHERE id=? AND owner_id=?`, id, ownerID)
	}
	if err != nil {
		log.Printf("ERROR: 删除账号失败: %v", err)
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
}

// ─── ApiKey CRUD ──────────────────────────────────────────────────────────────

func GetKeys(ownerID, accountID string) []ApiKey {
	s := globalState
	query := `SELECT id, key, name, account_id, owner_id, enabled, request_count, last_used_at, created_at FROM api_keys WHERE 1=1`
	args := []interface{}{}
	if ownerID != "" {
		query += " AND owner_id=?"
		args = append(args, ownerID)
	}
	if accountID != "" {
		query += " AND account_id=?"
		args = append(args, accountID)
	}
	query += " ORDER BY created_at ASC"
	rows, err := s.db.Query(query, args...)
	if err != nil {
		log.Printf("ERROR: 查询 API 密钥失败: %v", err)
		return nil
	}
	defer rows.Close()

	var result []ApiKey
	for rows.Next() {
		k, err := scanApiKeyRow(rows)
		if err != nil {
			log.Printf("WARN: 扫描 API 密钥行失败: %v", err)
			continue
		}
		result = append(result, k)
	}
	return result
}

func GetKeyByID(id, ownerID string) *ApiKey {
	s := globalState
	const q = `SELECT id, key, name, account_id, owner_id, enabled, request_count, last_used_at, created_at FROM api_keys WHERE id=?`
	var row *sql.Row
	if ownerID == "" {
		row = s.db.QueryRow(q, id)
	} else {
		row = s.db.QueryRow(q+" AND owner_id=?", id, ownerID)
	}
	k, err := scanApiKeyRow(row)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		log.Printf("ERROR: 查询 API 密钥失败: %v", err)
		return nil
	}
	return &k
}

func AddKey(key ApiKey) {
	s := globalState
	encKey := crypto.Encrypt(key.Key)
	enabledInt := 0
	if key.Enabled {
		enabledInt = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO api_keys (id, key, name, account_id, owner_id, enabled, request_count, last_used_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
		key.ID, encKey, key.Name, key.AccountID, key.OwnerID, enabledInt, key.RequestCount, nullString(key.LastUsedAt), key.CreatedAt,
	)
	if err != nil {
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
	encKey := crypto.Encrypt(k.Key)
	enabledInt := 0
	if k.Enabled {
		enabledInt = 1
	}
	_, err := s.db.Exec(
		`UPDATE api_keys SET key=?, name=?, enabled=? WHERE id=?`,
		encKey, k.Name, enabledInt, id,
	)
	if err != nil {
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
	var res sql.Result
	var err error
	if ownerID == "" {
		res, err = s.db.Exec(`DELETE FROM api_keys WHERE id=?`, id)
	} else {
		res, err = s.db.Exec(`DELETE FROM api_keys WHERE id=? AND owner_id=?`, id, ownerID)
	}
	if err != nil {
		log.Printf("ERROR: 删除 API 密钥失败: %v", err)
		return false
	}
	n, _ := res.RowsAffected()
	if n == 0 {
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
	offset := (page - 1) * limit

	countQuery := "SELECT COUNT(*) FROM request_logs WHERE 1=1"
	dataQuery := `SELECT id, api_key_id, account_id, api_key_name, account_name, method, path, status_code, duration_ms, model, error, created_at FROM request_logs WHERE 1=1`
	args := []interface{}{}

	if accountID != "" {
		countQuery += " AND account_id=?"
		dataQuery += " AND account_id=?"
		args = append(args, accountID)
	}
	if apiKeyID != "" {
		countQuery += " AND api_key_id=?"
		dataQuery += " AND api_key_id=?"
		args = append(args, apiKeyID)
	}
	dataQuery += " ORDER BY created_at DESC LIMIT ? OFFSET ?"

	var total int
	if err := s.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		log.Printf("ERROR: 查询日志数量失败: %v", err)
		return LogsResult{Logs: []RequestLog{}, Total: 0}
	}

	dataArgs := append(args, limit, offset)
	rows, err := s.db.Query(dataQuery, dataArgs...)
	if err != nil {
		log.Printf("ERROR: 查询日志失败: %v", err)
		return LogsResult{Logs: []RequestLog{}, Total: total}
	}
	defer rows.Close()

	var logs []RequestLog
	for rows.Next() {
		l, err := scanRequestLogRow(rows)
		if err != nil {
			log.Printf("WARN: 扫描日志行失败: %v", err)
			continue
		}
		logs = append(logs, l)
	}
	if logs == nil {
		logs = []RequestLog{}
	}
	return LogsResult{Logs: logs, Total: total}
}

func AppendLog(l RequestLog) {
	s := globalState
	_, err := s.db.Exec(
		`INSERT INTO request_logs (id, api_key_id, account_id, api_key_name, account_name, method, path, status_code, duration_ms, model, error, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		l.ID, l.ApiKeyID, l.AccountID, l.ApiKeyName, l.AccountName,
		l.Method, l.Path, l.StatusCode, l.DurationMs,
		nullString(l.Model), nullString(l.Error), l.CreatedAt,
	)
	if err != nil {
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
	if _, err := s.db.Exec(
		`UPDATE api_keys SET request_count = request_count + 1, last_used_at = ? WHERE id = ?`,
		now, keyID,
	); err != nil {
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
	s.db.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&stats.TotalAccounts)
	s.db.QueryRow("SELECT COUNT(*) FROM api_keys WHERE enabled=1").Scan(&stats.EnabledKeys)
	s.db.QueryRow("SELECT COUNT(*) FROM request_logs").Scan(&stats.TotalRequests)

	today := time.Now().UTC().Format("2006-01-02")
	tomorrow := time.Now().UTC().AddDate(0, 0, 1).Format("2006-01-02")
	s.db.QueryRow(
		"SELECT COUNT(*) FROM request_logs WHERE created_at >= ? AND created_at < ?",
		today+"T00:00:00Z", tomorrow+"T00:00:00Z",
	).Scan(&stats.TodayRequests)
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
	rows, err := s.db.Query(`SELECT id, username, password_hash, role, created_at, created_by, last_login_at FROM users ORDER BY created_at ASC`)
	if err != nil {
		log.Printf("ERROR: 查询用户失败: %v", err)
		return nil
	}
	defer rows.Close()

	var result []User
	for rows.Next() {
		u, err := scanUserRow(rows)
		if err != nil {
			log.Printf("WARN: 扫描用户行失败: %v", err)
			continue
		}
		result = append(result, u)
	}
	return result
}

func GetUserByID(id string) *User {
	s := globalState
	row := s.db.QueryRow(`SELECT id, username, password_hash, role, created_at, created_by, last_login_at FROM users WHERE id=?`, id)
	u, err := scanUserRow(row)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		log.Printf("ERROR: 查询用户失败: %v", err)
		return nil
	}
	return &u
}

func GetUserByUsername(username string) *User {
	s := globalState
	row := s.db.QueryRow(`SELECT id, username, password_hash, role, created_at, created_by, last_login_at FROM users WHERE username=?`, username)
	u, err := scanUserRow(row)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		log.Printf("ERROR: 查询用户失败: %v", err)
		return nil
	}
	return &u
}

func AddUser(user User) {
	s := globalState
	_, err := s.db.Exec(
		`INSERT INTO users (id, username, password_hash, role, created_at, created_by, last_login_at) VALUES (?,?,?,?,?,?,?)`,
		user.ID, user.Username, user.PasswordHash, string(user.Role), user.CreatedAt,
		nullString(user.CreatedBy), nullString(user.LastLoginAt),
	)
	if err != nil {
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
	_, err := s.db.Exec(
		`UPDATE users SET username=?, password_hash=?, role=?, last_login_at=? WHERE id=?`,
		u.Username, u.PasswordHash, string(u.Role), nullString(u.LastLoginAt), id,
	)
	if err != nil {
		log.Printf("ERROR: 更新用户失败: %v", err)
		return nil
	}
	return u
}

func DeleteUser(id string) bool {
	s := globalState
	res, err := s.db.Exec(`DELETE FROM users WHERE id=?`, id)
	if err != nil {
		log.Printf("ERROR: 删除用户失败: %v", err)
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
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
	var initializedInt int
	err := s.db.QueryRow(`SELECT initialized, admin_created_at FROM system_config WHERE id=1`).Scan(&initializedInt, &config.AdminCreatedAt)
	if err != nil {
		return nil
	}
	config.Initialized = initializedInt != 0
	if !config.Initialized {
		return nil
	}
	return &config
}

func SetSystemConfig(config SystemConfig) {
	s := globalState
	initializedInt := 0
	if config.Initialized {
		initializedInt = 1
	}
	_, err := s.db.Exec(
		`UPDATE system_config SET initialized=?, admin_created_at=? WHERE id=1`,
		initializedInt, config.AdminCreatedAt,
	)
	if err != nil {
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
