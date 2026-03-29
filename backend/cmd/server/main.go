package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"copilot-manager/internal/config"
	"copilot-manager/internal/crypto"
	"copilot-manager/internal/handler"
	"copilot-manager/internal/idgen"
	"copilot-manager/internal/store"
)

func main() {
	cfg := config.Load()

	// Initialize encryption (exits if ENCRYPTION_KEY not set or invalid)
	crypto.InitEncryption()

	// Determine data directory
	dataDir := handler.ResolveDataDir()
	log.Printf("INFO: 数据目录: %s", dataDir)

	// Initialize and load store
	store.Init(dataDir)
	store.LoadStore()
	log.Println("INFO: 数据加载完成")

	// Create admin from env vars if not initialized
	initAdminFromEnv(cfg)

	// Set login config for handlers
	handler.SetLoginConfig(handler.LoginConfig{
		TrustedProxy: cfg.TrustedProxy,
		NodeEnv:      cfg.NodeEnv,
		HTTPS:        cfg.HTTPS,
	})

	// Build router
	router := handler.NewRouter(cfg.RateLimitPerMinute)

	// Start server
	addr := ":" + cfg.Port
	srv := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 610 * time.Second, // must be > proxy timeout (600s)
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("INFO: 服务器启动在 http://localhost%s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("FATAL: 服务器启动失败: %v", err)
		}
	}()

	<-quit
	log.Println("INFO: 收到退出信号，开始优雅关闭...")

	// Flush pending writes before shutdown
	store.FlushPendingWrites()
	log.Println("INFO: 待写入数据已刷盘")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("ERROR: 服务器关闭超时: %v", err)
	}
	log.Println("INFO: 服务器已停止")
}

// initAdminFromEnv creates the admin user from environment variables on first run.
func initAdminFromEnv(cfg *config.Config) {
	systemConfig := store.GetSystemConfig()
	if systemConfig != nil && systemConfig.Initialized {
		return // already initialized
	}
	if cfg.AdminUsername == "" || cfg.AdminPassword == "" {
		log.Println("WARN: 系统未初始化且未设置 ADMIN_USERNAME/ADMIN_PASSWORD，跳过自动创建管理员")
		return
	}
	if len(cfg.AdminPassword) < 6 {
		log.Println("ERROR: ADMIN_PASSWORD 必须至少 6 个字符")
		return
	}

	hash, err := crypto.HashPassword(cfg.AdminPassword)
	if err != nil {
		log.Printf("ERROR: 管理员密码哈希失败: %v", err)
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)
	adminUser := store.User{
		ID:           idgen.GenerateID("usr"),
		Username:     cfg.AdminUsername,
		PasswordHash: hash,
		Role:         store.RoleAdmin,
		CreatedAt:    now,
		CreatedBy:    nil,
		LastLoginAt:  nil,
	}
	store.AddUser(adminUser)

	store.SetSystemConfig(store.SystemConfig{
		Initialized:    true,
		AdminCreatedAt: now,
	})
	log.Printf("INFO: 管理员账户 '%s' 已创建", cfg.AdminUsername)
}
