package handler

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"copilot-manager/internal/idgen"
	"copilot-manager/internal/ratelimit"
	"copilot-manager/internal/store"
)

const maxBodySize = 100 * 1024 * 1024 // 100MB

// ProxyHandler holds the proxy-specific dependencies.
type ProxyHandler struct {
	limiter *ratelimit.ProxyLimiter
}

// NewProxyHandler creates a new ProxyHandler.
func NewProxyHandler(rateLimitPerMin int) *ProxyHandler {
	return &ProxyHandler{
		limiter: ratelimit.NewProxyLimiter(rateLimitPerMin),
	}
}

// ServeHTTP handles all /v1/* proxy requests.
func (h *ProxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	startTime := time.Now()

	// Extract Bearer token
	authHeader := r.Header.Get("Authorization")
	var apiKey string
	if strings.HasPrefix(authHeader, "Bearer ") {
		apiKey = strings.TrimSpace(authHeader[7:])
	}
	if apiKey == "" {
		writeError(w, http.StatusUnauthorized, "Missing Authorization header")
		return
	}

	// Validate API key
	key, account := store.FindKeyWithAccount(apiKey)
	if key == nil {
		writeError(w, http.StatusUnauthorized, "Invalid API key")
		return
	}
	if account == nil {
		writeError(w, http.StatusNotFound, "Account not found")
		return
	}
	if account.APIURL == "" {
		writeError(w, http.StatusServiceUnavailable,
			"Account \""+account.Name+"\" has no api_url configured")
		return
	}

	// Rate limit
	if allowed, retryAfter := h.limiter.Allow(key.ID); !allowed {
		w.Header().Set("Retry-After", itoa(retryAfter))
		writeError(w, http.StatusTooManyRequests, "Rate limit exceeded")
		return
	}

	// Check Content-Length
	if r.ContentLength > maxBodySize {
		writeError(w, http.StatusRequestEntityTooLarge, "Request body too large")
		return
	}

	// Read body (for model extraction and forwarding)
	var bodyBytes []byte
	var model *string

	hasBody := r.Method != http.MethodGet && r.Method != http.MethodHead
	if hasBody && r.Body != nil {
		bodyBytes, _ = io.ReadAll(io.LimitReader(r.Body, maxBodySize+1))
		if int64(len(bodyBytes)) > maxBodySize {
			writeError(w, http.StatusRequestEntityTooLarge, "Request body too large")
			return
		}
		ct := r.Header.Get("Content-Type")
		if strings.Contains(ct, "application/json") && len(bodyBytes) > 0 {
			var parsed struct {
				Model string `json:"model"`
			}
			if err := json.Unmarshal(bodyBytes, &parsed); err == nil && parsed.Model != "" {
				model = &parsed.Model
			}
		}
	}

	// Build upstream URL
	baseURL := strings.TrimRight(account.APIURL, "/")
	// r.URL.Path already includes /v1/..., account.APIURL might already have /v1 prefix
	// We proxy /v1/* as-is to the upstream
	upstreamURL := baseURL + r.URL.RequestURI()

	// Build upstream request
	ctx, cancel := context.WithTimeout(r.Context(), 600*time.Second)
	defer cancel()

	var bodyReader io.Reader
	if len(bodyBytes) > 0 {
		bodyReader = strings.NewReader(string(bodyBytes))
	}

	upstreamReq, err := http.NewRequestWithContext(ctx, r.Method, upstreamURL, bodyReader)
	if err != nil {
		h.logAndRecord(key, account, r, 502, time.Since(startTime), model, err.Error())
		writeError(w, http.StatusBadGateway, "Upstream service unavailable")
		return
	}

	// Copy headers (exclude Authorization, Host, Content-Length)
	for k, vals := range r.Header {
		lower := strings.ToLower(k)
		if lower == "authorization" || lower == "host" || lower == "content-length" {
			continue
		}
		for _, v := range vals {
			upstreamReq.Header.Add(k, v)
		}
	}
	if len(bodyBytes) > 0 {
		upstreamReq.ContentLength = int64(len(bodyBytes))
	}

	// Execute upstream request
	upstreamClient := &http.Client{
		Timeout: 605 * time.Second, // slightly more than context timeout
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse // don't follow redirects
		},
	}
	upstreamResp, err := upstreamClient.Do(upstreamReq)
	if err != nil {
		errMsg := err.Error()
		log.Printf("INFO: Proxy upstream error for account %s: %v", account.ID, err)
		go h.logAndRecord(key, account, r, 502, time.Since(startTime), model, errMsg)
		writeError(w, http.StatusBadGateway, "Upstream service unavailable")
		return
	}
	defer upstreamResp.Body.Close()

	durationMs := time.Since(startTime).Milliseconds()

	// Async log (non-blocking)
	go h.logAndRecord(key, account, r, upstreamResp.StatusCode, time.Duration(durationMs)*time.Millisecond, model, "")

	// Copy response headers (drop content-encoding to avoid double-decompression)
	for k, vals := range upstreamResp.Header {
		if strings.ToLower(k) == "content-encoding" {
			continue
		}
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(upstreamResp.StatusCode)

	// Stream response body with flush support
	flusher, canFlush := w.(http.Flusher)
	buf := make([]byte, 32*1024)
	for {
		n, readErr := upstreamResp.Body.Read(buf)
		if n > 0 {
			_, _ = w.Write(buf[:n])
			if canFlush {
				flusher.Flush()
			}
		}
		if readErr != nil {
			break
		}
	}
}

func (h *ProxyHandler) logAndRecord(
	key *store.ApiKey,
	account *store.Account,
	r *http.Request,
	statusCode int,
	duration time.Duration,
	model *string,
	errMsg string,
) {
	store.IncrementKeyRequestCount(key.ID)

	var errPtr *string
	if errMsg != "" {
		errPtr = &errMsg
	}

	logEntry := store.RequestLog{
		ID:          idgen.GenerateID("log"),
		ApiKeyID:    key.ID,
		AccountID:   account.ID,
		ApiKeyName:  key.Name,
		AccountName: account.Name,
		Method:      r.Method,
		Path:        r.URL.Path,
		StatusCode:  statusCode,
		DurationMs:  duration.Milliseconds(),
		Model:       model,
		Error:       errPtr,
		CreatedAt:   nowISO(),
	}
	store.AppendLog(logEntry)
}
