package middleware

import (
	"net/http"
	"strings"
	"time"

	"copilot-manager/internal/store"
)

type contextKey string

const (
	ContextKeyUserID   contextKey = "user_id"
	ContextKeyUserRole contextKey = "user_role"
	ContextKeyUser     contextKey = "user"
)

// AuthMiddleware validates the cm_session cookie and populates context with user info.
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sessionID := getSessionID(r)
		if sessionID == "" {
			writeUnauthorized(w)
			return
		}

		session := store.GetSession(sessionID)
		if session == nil {
			writeUnauthorized(w)
			return
		}

		// Check expiry
		expiry, err := time.Parse(time.RFC3339, session.ExpiresAt)
		if err != nil || time.Now().After(expiry) {
			store.DeleteSession(sessionID)
			writeUnauthorized(w)
			return
		}

		user := store.GetUserByID(session.UserID)
		if user == nil {
			writeUnauthorized(w)
			return
		}

		// Store in context
		ctx := r.Context()
		ctx = contextWithValue(ctx, ContextKeyUserID, user.ID)
		ctx = contextWithValue(ctx, ContextKeyUserRole, string(user.Role))
		ctx = contextWithValue(ctx, ContextKeyUser, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// AdminMiddleware ensures the user has admin role. Must be used after AuthMiddleware.
func AdminMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role, _ := r.Context().Value(ContextKeyUserRole).(string)
		if role != string(store.RoleAdmin) {
			writeForbidden(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// getSessionID extracts session ID from Cookie, X-Session-Id header, or session_id query param.
func getSessionID(r *http.Request) string {
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

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"Unauthorized"}`))
}

func writeForbidden(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_, _ = w.Write([]byte(`{"error":"Forbidden"}`))
}

// GetUserID extracts the user ID from the request context.
func GetUserID(r *http.Request) string {
	v, _ := r.Context().Value(ContextKeyUserID).(string)
	return v
}

// GetUserRole extracts the user role from the request context.
func GetUserRole(r *http.Request) string {
	v, _ := r.Context().Value(ContextKeyUserRole).(string)
	return v
}

// IsAdmin returns true if the current user has admin role.
func IsAdmin(r *http.Request) bool {
	return strings.EqualFold(GetUserRole(r), string(store.RoleAdmin))
}
