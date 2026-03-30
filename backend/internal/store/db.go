package store

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// openDB opens the SQLite database via GORM and applies performance PRAGMAs.
func openDB(dir string) (*gorm.DB, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}
	dbPath := filepath.Join(dir, "copilot-manager.db")

	db, err := gorm.Open(sqlite.Open(dbPath+"?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL&_foreign_keys=ON"), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 失败: %w", err)
	}

	// Single connection serialises all writes; avoids SQLITE_BUSY.
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("获取底层 DB 失败: %w", err)
	}
	sqlDB.SetMaxOpenConns(1)

	return db, nil
}

// execMigrate runs GORM AutoMigrate for all models and seeds system_config.
func execMigrate(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&User{}, &Account{}, &ApiKey{}, &RequestLog{}, &SystemConfig{},
	); err != nil {
		return fmt.Errorf("AutoMigrate 失败: %w", err)
	}

	// Ensure the initial system_config row exists.
	db.FirstOrCreate(&SystemConfig{ID: 1, Initialized: false, AdminCreatedAt: ""})

	// Create indexes that GORM AutoMigrate doesn't auto-create.
	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_account_id ON request_logs(account_id)`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_api_key_id ON request_logs(api_key_id)`,
		`CREATE INDEX IF NOT EXISTS idx_api_keys_account_id ON api_keys(account_id)`,
		`CREATE INDEX IF NOT EXISTS idx_api_keys_enabled ON api_keys(enabled)`,
	}
	for _, idx := range indexes {
		if err := db.Exec(idx).Error; err != nil {
			log.Printf("WARN: 创建索引失败: %v", err)
		}
	}
	return nil
}
