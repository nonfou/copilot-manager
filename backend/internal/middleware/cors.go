package middleware

import (
	"net/http"
	"os"
	"strings"
)

// CORS handles Cross-Origin Resource Sharing.
// Mirrors the TS CORS configuration: function-based origin, credentials: true.
func CORS(next http.Handler) http.Handler {
	isProduction := os.Getenv("NODE_ENV") == "production"

	getAllowedOrigins := func() []string {
		raw := os.Getenv("CORS_ALLOWED_ORIGINS")
		if raw == "" {
			return nil
		}
		var result []string
		for _, o := range strings.Split(raw, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				result = append(result, o)
			}
		}
		return result
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		if origin == "" {
			// Same-origin or curl - allow
			next.ServeHTTP(w, r)
			return
		}

		allowed := getAllowedOrigins()
		var allowOrigin string
		if len(allowed) == 0 {
			if isProduction {
				allowOrigin = "" // production: deny all cross-origin if no whitelist
			} else {
				allowOrigin = origin // dev: allow all origins
			}
		} else {
			for _, o := range allowed {
				if o == origin {
					allowOrigin = origin
					break
				}
			}
		}

		if allowOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", allowOrigin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}

		if r.Method == http.MethodOptions {
			if allowOrigin != "" {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-Id")
				w.Header().Set("Access-Control-Max-Age", "86400")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
