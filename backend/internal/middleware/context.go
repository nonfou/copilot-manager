package middleware

import (
	"context"
)

// contextWithValue is a helper to avoid linting issues with using string keys directly.
func contextWithValue(ctx context.Context, key contextKey, val interface{}) context.Context {
	return context.WithValue(ctx, key, val)
}
