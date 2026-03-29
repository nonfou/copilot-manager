package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"copilot-manager/internal/crypto"
	"copilot-manager/internal/middleware"
	"copilot-manager/internal/ratelimit"
	"copilot-manager/internal/store"
)

var loginLimiter = ratelimit.NewLoginLimiter()

// ─── GET /api/auth/status ───────────────────────────────────────────────────

func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	config := store.GetSystemConfig()

	// Try to get user from session header/query (not cookie auth middleware)
	var userInfo interface{}
	if config != nil && config.Initialized {
		sessionID := getSessionIDFromRequest(r)
		if sessionID != "" {
			session := store.GetSession(sessionID)
			if session != nil {
				expiry, err := time.Parse(time.RFC3339, session.ExpiresAt)
				if err == nil && time.Now().Before(expiry) {
					u := store.GetUserByID(session.UserID)
					if u != nil {
						userInfo = M{"id": u.ID, "username": u.Username, "role": u.Role}
					}
				}
			}
		}
	}

	initialized := false
	if config != nil {
		initialized = config.Initialized
	}
	writeJSON(w, http.StatusOK, M{
		"initialized": initialized,
		"user":        userInfo,
	})
}

// getSessionIDFromRequest extracts session ID from multiple sources.
func getSessionIDFromRequest(r *http.Request) string {
	if cookie, err := r.Cookie("cm_session"); err == nil && cookie.Value != "" {
		return cookie.Value
	}
	if h := r.Header.Get("X-Session-Id"); h != "" {
		return h
	}
	if q := r.URL.Query().Get("session_id"); q != "" {
		return q
	}
	return ""
}

// ─── POST /api/auth/setup ──────────────────────────────────────────────────

func handleAuthSetup(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusForbidden,
		"Setup via API is disabled. Please use CLI: copilot-manager init -u <username> -p <password>")
}

// ─── POST /api/auth/login ──────────────────────────────────────────────────

func handleAuthLogin(cfg LoginConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		config := store.GetSystemConfig()
		if config == nil || !config.Initialized {
			writeError(w, http.StatusServiceUnavailable, "System not initialized")
			return
		}

		ip := getClientIP(r, cfg.TrustedProxy)

		// IP rate limit check
		if allowed, retryAfter := loginLimiter.Check(ip); !allowed {
			w.Header().Set("Retry-After", itoa(retryAfter))
			writeError(w, http.StatusTooManyRequests, "登录尝试次数过多，请稍后再试。")
			return
		}

		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		if body.Username == "" || body.Password == "" {
			writeError(w, http.StatusBadRequest, "Username and password required")
			return
		}

		// Username rate limit check
		userKey := ratelimit.UserKey(body.Username)
		if allowed, retryAfter := loginLimiter.Check(userKey); !allowed {
			w.Header().Set("Retry-After", itoa(retryAfter))
			writeError(w, http.StatusTooManyRequests, "登录尝试次数过多，请稍后再试。")
			return
		}

		user := store.GetUserByUsername(body.Username)
		if user == nil {
			loginLimiter.RecordFailure(ip)
			loginLimiter.RecordFailure(userKey)
			writeError(w, http.StatusUnauthorized, "Invalid credentials")
			return
		}

		valid, err := crypto.VerifyPassword(body.Password, user.PasswordHash)
		if err != nil || !valid {
			loginLimiter.RecordFailure(ip)
			loginLimiter.RecordFailure(userKey)
			writeError(w, http.StatusUnauthorized, "Invalid credentials")
			return
		}

		// Login success - clear rate limits
		loginLimiter.Clear(ip, body.Username)

		// Create session
		now := time.Now().UTC()
		sessionID := generateSessionID()
		expiresAt := now.Add(24 * time.Hour)
		store.SetSession(store.UserSession{
			SessionID: sessionID,
			UserID:    user.ID,
			CreatedAt: now.Format(time.RFC3339),
			ExpiresAt: expiresAt.Format(time.RFC3339),
		})

		// Set cookie
		secure := cfg.NodeEnv == "production" || cfg.HTTPS
		http.SetCookie(w, &http.Cookie{
			Name:     "cm_session",
			Value:    sessionID,
			HttpOnly: true,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   86400,
			Path:     "/",
			Secure:   secure,
		})

		// Update last login
		nowStr := now.Format(time.RFC3339)
		store.UpdateUser(user.ID, M{"last_login_at": nowStr})

		writeJSON(w, http.StatusOK, M{
			"success": true,
			"user":    M{"id": user.ID, "username": user.Username, "role": user.Role},
		})
	}
}

// ─── POST /api/auth/logout ─────────────────────────────────────────────────

func handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	sessionID := getSessionIDFromRequest(r)
	if sessionID != "" {
		store.DeleteSession(sessionID)
	}
	http.SetCookie(w, &http.Cookie{
		Name:    "cm_session",
		Value:   "",
		MaxAge:  -1,
		Path:    "/",
		Expires: time.Unix(0, 0),
	})
	writeJSON(w, http.StatusOK, M{"success": true})
}

// ─── GET /api/auth/me ──────────────────────────────────────────────────────

func handleAuthMe(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	user := store.GetUserByID(userID)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	writeJSON(w, http.StatusOK, M{
		"id":            user.ID,
		"username":      user.Username,
		"role":          user.Role,
		"created_at":    user.CreatedAt,
		"last_login_at": user.LastLoginAt,
	})
}

// ─── POST /api/auth/change-password ───────────────────────────────────────

func handleAuthChangePassword(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.CurrentPassword == "" || body.NewPassword == "" {
		writeError(w, http.StatusBadRequest, "Current and new password required")
		return
	}
	if len(body.NewPassword) < 6 {
		writeError(w, http.StatusBadRequest, "New password must be at least 6 characters")
		return
	}

	user := store.GetUserByID(userID)
	if user == nil {
		writeError(w, http.StatusNotFound, "User not found")
		return
	}

	valid, err := crypto.VerifyPassword(body.CurrentPassword, user.PasswordHash)
	if err != nil || !valid {
		writeError(w, http.StatusBadRequest, "Current password is incorrect")
		return
	}

	newHash, err := crypto.HashPassword(body.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}
	store.UpdateUser(userID, M{"password_hash": newHash})
	writeJSON(w, http.StatusOK, M{"success": true})
}

// LoginConfig holds configuration for the login handler.
type LoginConfig struct {
	TrustedProxy bool
	NodeEnv      string
	HTTPS        bool
}
