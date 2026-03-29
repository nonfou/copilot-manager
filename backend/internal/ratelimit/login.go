package ratelimit

import (
	"strings"
	"sync"
	"time"
)

const (
	maxLoginAttempts  = 5
	lockDuration      = 15 * time.Minute
)

type attemptRecord struct {
	count       int
	lockedUntil time.Time
}

// LoginLimiter tracks login attempts per IP and per username.
type LoginLimiter struct {
	mu       sync.Mutex
	attempts map[string]*attemptRecord
}

// NewLoginLimiter creates a new LoginLimiter.
func NewLoginLimiter() *LoginLimiter {
	return &LoginLimiter{
		attempts: make(map[string]*attemptRecord),
	}
}

// Check returns (allowed, retryAfterSeconds). retryAfterSeconds is 0 when allowed.
func (l *LoginLimiter) Check(key string) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	rec := l.attempts[key]
	if rec == nil {
		return true, 0
	}
	if !rec.lockedUntil.IsZero() && rec.lockedUntil.After(now) {
		retryAfter := int(rec.lockedUntil.Sub(now).Seconds()) + 1
		return false, retryAfter
	}
	// Lock has expired, clear record
	if !rec.lockedUntil.IsZero() && !rec.lockedUntil.After(now) {
		delete(l.attempts, key)
	}
	return true, 0
}

// RecordFailure records a failed login attempt for the given key.
func (l *LoginLimiter) RecordFailure(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	rec := l.attempts[key]
	if rec == nil {
		rec = &attemptRecord{}
		l.attempts[key] = rec
	}
	rec.count++
	if rec.count >= maxLoginAttempts {
		rec.lockedUntil = time.Now().Add(lockDuration)
	}
}

// Clear removes all attempt records for the given IP and username.
func (l *LoginLimiter) Clear(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, ip)
	delete(l.attempts, "user:"+strings.ToLower(username))
}

// UserKey returns the rate limit key for a username.
func UserKey(username string) string {
	return "user:" + strings.ToLower(username)
}
