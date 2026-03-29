package handler

import (
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"copilot-manager/internal/middleware"
	"copilot-manager/internal/store"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

// NewRouter builds and returns the main chi.Router.
func NewRouter(rateLimitPerMin int) http.Handler {
	r := chi.NewRouter()

	// Global middleware
	r.Use(chiMiddleware.RealIP)
	r.Use(middleware.SecurityHeaders)
	r.Use(middleware.CORS)
	r.Use(chiMiddleware.Recoverer)

	// Health check (no auth)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		accounts := store.GetAccounts("")
		uptimeSeconds := int64(math.Floor(time.Since(startTime).Seconds()))
		writeJSON(w, http.StatusOK, M{
			"status": "ok",
			"uptime": uptimeSeconds,
			"accounts": M{
				"total": len(accounts),
			},
		})
	})

	// Auth routes (some public, some protected)
	r.Route("/api/auth", func(r chi.Router) {
		r.Get("/status", handleAuthStatus)
		r.Post("/setup", handleAuthSetup)
		r.Post("/login", handleAuthLogin(loginCfg))
		r.Post("/logout", handleAuthLogout)

		// Protected auth routes
		r.Group(func(r chi.Router) {
			r.Use(middleware.AuthMiddleware)
			r.Get("/me", handleAuthMe)
			r.Post("/change-password", handleAuthChangePassword)
		})
	})

	// Protected API routes
	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthMiddleware)

		// Accounts
		r.Route("/api/accounts", func(r chi.Router) {
			r.Get("/", handleListAccounts)
			r.Post("/", handleCreateAccount)
			// Static routes before parameterized ones
			r.Post("/auth/start", handleAuthStart)
			r.Get("/auth/poll/{auth_id}", handleAuthPoll)
			r.Put("/{id}", handleUpdateAccount)
			r.Delete("/{id}", handleDeleteAccount)
			r.Get("/{id}/usage", handleGetAccountUsage)
			r.Get("/{id}/models", handleGetAccountModels)
		})

		// Keys
		r.Route("/api/keys", func(r chi.Router) {
			r.Get("/", handleListKeys)
			r.Post("/", handleCreateKey)
			r.Get("/{id}", handleGetKey)
			r.Put("/{id}", handleUpdateKey)
			r.Delete("/{id}", handleDeleteKey)
			r.Post("/{id}/regenerate", handleRegenerateKey)
		})

		// Logs
		r.Get("/api/logs", handleLogs)

		// Stats
		r.Get("/api/stats", handleStats)

		// Users (admin only, enforced inside handler registration)
		r.Route("/api/users", func(r chi.Router) {
			r.Use(middleware.AdminMiddleware)
			r.Get("/", handleListUsers)
			r.Post("/", handleCreateUser)
			r.Get("/{id}", handleGetUser)
			r.Put("/{id}", handleUpdateUser)
			r.Delete("/{id}", handleDeleteUser)
			r.Post("/{id}/reset-password", handleResetPassword)
		})
	})

	// Static UI files
	publicDir := resolvePublicDir()
	r.Get("/ui", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/ui/", http.StatusFound)
	})
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/ui/", http.StatusFound)
	})
	r.Handle("/ui/*", http.StripPrefix("/ui", http.FileServer(http.Dir(publicDir))))

	// Proxy route (no auth middleware - handled inside proxy)
	proxy := NewProxyHandler(rateLimitPerMin)
	r.Handle("/v1/*", proxy)
	r.Handle("/v1", proxy)

	return r
}

// resolvePublicDir returns the path to the public directory.
// Tries ./public relative to the working directory.
func resolvePublicDir() string {
	// When running from project root
	if info, err := os.Stat("public"); err == nil && info.IsDir() {
		return "public"
	}
	// When running from backend/
	if info, err := os.Stat("../public"); err == nil && info.IsDir() {
		return "../public"
	}
	// Absolute path fallback
	exe, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exe)
		candidate := filepath.Join(dir, "public")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}
	return "public"
}

// resolveDataDir returns the path to the data directory.
func resolveDataDir() string {
	if info, err := os.Stat("data"); err == nil && info.IsDir() {
		return "data"
	}
	if info, err := os.Stat("../data"); err == nil && info.IsDir() {
		return "../data"
	}
	return "data"
}

// loginCfg is populated by main before the server starts.
var loginCfg LoginConfig

// startTime is set when the server starts for uptime calculation.
var startTime = time.Now()

// SetLoginConfig sets the login configuration (called from main).
func SetLoginConfig(cfg LoginConfig) {
	loginCfg = cfg
}

// ResolveDataDir is exported for use from main.go.
func ResolveDataDir() string {
	return resolveDataDir()
}

// StripSlash is a middleware that strips trailing slashes.
func StripSlash(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && strings.HasSuffix(r.URL.Path, "/") {
			r.URL.Path = strings.TrimSuffix(r.URL.Path, "/")
		}
		next.ServeHTTP(w, r)
	})
}
