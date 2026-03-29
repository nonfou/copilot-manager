package store

import (
	"sync"
	"time"
)

// debouncedWriter delays writes to reduce I/O on hot paths.
type debouncedWriter struct {
	mu        sync.Mutex
	timer     *time.Timer
	writeFunc func()
	delay     time.Duration
}

func newDebouncedWriter(delay time.Duration, fn func()) *debouncedWriter {
	return &debouncedWriter{
		writeFunc: fn,
		delay:     delay,
	}
}

// Schedule schedules the write function to be called after the debounce delay.
// If already scheduled, it does nothing (first-call semantics, matching TS behavior).
func (d *debouncedWriter) Schedule() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.timer != nil {
		return // already scheduled
	}
	d.timer = time.AfterFunc(d.delay, func() {
		d.mu.Lock()
		d.timer = nil
		d.mu.Unlock()
		d.writeFunc()
	})
}

// Flush cancels any pending timer and executes the write immediately.
func (d *debouncedWriter) Flush() {
	d.mu.Lock()
	if d.timer != nil {
		d.timer.Stop()
		d.timer = nil
	}
	d.mu.Unlock()
	d.writeFunc()
}
