package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS system_config (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    initialized      INTEGER NOT NULL DEFAULT 0,
    admin_created_at TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO system_config (id, initialized, admin_created_at) VALUES (1, 0, '');
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    TEXT NOT NULL,
    created_by    TEXT,
    last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS accounts (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    github_token TEXT NOT NULL,
    account_type TEXT NOT NULL DEFAULT 'individual',
    api_url      TEXT NOT NULL,
    owner_id     TEXT NOT NULL,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_owner_id ON accounts(owner_id);
CREATE TABLE IF NOT EXISTS api_keys (
    id            TEXT PRIMARY KEY,
    key           TEXT NOT NULL,
    name          TEXT NOT NULL,
    account_id    TEXT NOT NULL,
    owner_id      TEXT NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 1,
    request_count INTEGER NOT NULL DEFAULT 0,
    last_used_at  TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_account_id ON api_keys(account_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner_id ON api_keys(owner_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_enabled ON api_keys(enabled);
CREATE TABLE IF NOT EXISTS request_logs (
    id                TEXT PRIMARY KEY,
    api_key_id        TEXT NOT NULL,
    account_id        TEXT NOT NULL,
    api_key_name      TEXT NOT NULL,
    account_name      TEXT NOT NULL,
    method            TEXT NOT NULL,
    path              TEXT NOT NULL,
    status_code       INTEGER NOT NULL,
    duration_ms       INTEGER NOT NULL,
    model             TEXT,
    error             TEXT,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    total_tokens      INTEGER,
    first_token_ms    INTEGER,
    created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_account_id ON request_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_api_key_id ON request_logs(api_key_id);`

// openDB opens the SQLite database at dir/copilot-manager.db and applies
// performance PRAGMAs suitable for a single-writer workload.
func openDB(dir string) (*sql.DB, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}
	dbPath := filepath.Join(dir, "copilot-manager.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 失败: %w", err)
	}
	// Single connection serialises all writes; avoids SQLITE_BUSY.
	db.SetMaxOpenConns(1)
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
		"PRAGMA foreign_keys=ON",
	} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("PRAGMA 失败 (%s): %w", pragma, err)
		}
	}
	return db, nil
}

// execSchema splits sqliteSchema by ";" and executes each statement.
func execSchema(db *sql.DB) error {
	for _, stmt := range strings.Split(sqliteSchema, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := db.Exec(stmt); err != nil {
			short := stmt
			if len(short) > 60 {
				short = short[:60] + "..."
			}
			return fmt.Errorf("建表失败 (%s): %w", short, err)
		}
	}
	// Migrate: add token columns to existing request_logs table.
	for _, col := range []string{
		"prompt_tokens INTEGER",
		"completion_tokens INTEGER",
		"total_tokens INTEGER",
		"first_token_ms INTEGER",
	} {
		_, _ = db.Exec("ALTER TABLE request_logs ADD COLUMN " + col)
	}
	return nil
}
