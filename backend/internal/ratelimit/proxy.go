package ratelimit

import (
	"sync"
	"time"
)

// ProxyLimiter tracks per-API-key request rates using a fixed window counter.
type ProxyLimiter struct {
	mu          sync.Mutex
	records     map[string]*proxyRecord
	limitPerMin int
	windowMs    time.Duration
}

type proxyRecord struct {
	count       int
	windowStart time.Time
}

// NewProxyLimiter creates a new ProxyLimiter.
// limitPerMin of 0 disables rate limiting.
func NewProxyLimiter(limitPerMin int) *ProxyLimiter {
	return &ProxyLimiter{
		records:     make(map[string]*proxyRecord),
		limitPerMin: limitPerMin,
		windowMs:    time.Minute,
	}
}

// Allow returns (allowed, retryAfterSeconds).
func (p *ProxyLimiter) Allow(keyID string) (bool, int) {
	if p.limitPerMin <= 0 {
		return true, 0
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	now := time.Now()
	rec := p.records[keyID]
	if rec == nil || now.Sub(rec.windowStart) >= p.windowMs {
		p.records[keyID] = &proxyRecord{count: 1, windowStart: now}
		return true, 0
	}
	rec.count++
	if rec.count > p.limitPerMin {
		retryAfter := int(rec.windowStart.Add(p.windowMs).Sub(now).Seconds()) + 1
		return false, retryAfter
	}
	return true, 0
}
