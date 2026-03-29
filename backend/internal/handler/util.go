package handler

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"
)

// generateSessionID generates a 32-byte random hex session ID (matches TS: randomBytes(16).toString("hex"))
func generateSessionID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("failed to generate session ID")
	}
	return hex.EncodeToString(b)
}

// getClientIP extracts the client IP from the request.
// Respects X-Forwarded-For and X-Real-IP only when trustedProxy is true.
func getClientIP(r *http.Request, trustedProxy bool) string {
	if trustedProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			// Take first IP
			for i, c := range xff {
				if c == ',' {
					return xff[:i]
				}
			}
			return xff
		}
		if xri := r.Header.Get("X-Real-IP"); xri != "" {
			return xri
		}
	}
	// Use RemoteAddr
	addr := r.RemoteAddr
	// Strip port
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			return addr[:i]
		}
	}
	return addr
}

// itoa converts an int to string.
func itoa(n int) string {
	return strconv.Itoa(n)
}
