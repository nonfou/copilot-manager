package handler

import (
	"bytes"
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

// usageInfo holds token usage extracted from the upstream response.
type usageInfo struct {
	PromptTokens     *int64 `json:"prompt_tokens"`
	CompletionTokens *int64 `json:"completion_tokens"`
	TotalTokens      *int64 `json:"total_tokens"`
}

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
		h.logAndRecord(key, account, r, 502, time.Since(startTime), model, nil, 0, err.Error())
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
		Timeout: 605 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	upstreamResp, err := upstreamClient.Do(upstreamReq)
	if err != nil {
		errMsg := err.Error()
		log.Printf("INFO: Proxy upstream error for account %s: %v", account.ID, err)
		h.logAndRecord(key, account, r, 502, time.Since(startTime), model, nil, 0, errMsg)
		writeError(w, http.StatusBadGateway, "Upstream service unavailable")
		return
	}
	defer upstreamResp.Body.Close()

	// Measure first-byte latency (TTFB from upstream)
	firstTokenMs := time.Since(startTime).Milliseconds()

	// Determine if streaming response
	isStreaming := strings.Contains(
		strings.ToLower(upstreamResp.Header.Get("Content-Type")), "text/event-stream",
	)

	var usage *usageInfo

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

	if isStreaming {
		usage = h.streamAndCapture(w, upstreamResp.Body)
	} else {
		usage = h.bufferAndCapture(w, upstreamResp.Body)
	}

	// Update duration to include full response transfer
	durationMs := time.Since(startTime).Milliseconds()

	// Async log (non-blocking)
	go h.logAndRecord(key, account, r, upstreamResp.StatusCode, time.Duration(durationMs)*time.Millisecond, model, usage, firstTokenMs, "")
}

// bufferAndCapture reads the full non-streaming response body, extracts usage, then writes to client.
func (h *ProxyHandler) bufferAndCapture(w http.ResponseWriter, body io.Reader) *usageInfo {
	bodyBytes, err := io.ReadAll(io.LimitReader(body, maxBodySize+1))
	if err != nil {
		_, _ = w.Write(bodyBytes) // write whatever we got
		return nil
	}

	// Try to extract usage from JSON response
	var usage usageInfo
	if len(bodyBytes) > 0 && json.Unmarshal(bodyBytes, &struct {
		Usage *usageInfo `json:"usage"`
	}{Usage: &usage}) == nil && usage.TotalTokens != nil {
		// usage extracted successfully
	} else {
		usage = usageInfo{}
	}

	_, _ = w.Write(bodyBytes)
	return &usage
}

// streamAndCapture forwards SSE stream in real-time while scanning for usage data.
func (h *ProxyHandler) streamAndCapture(w http.ResponseWriter, body io.Reader) *usageInfo {
	flusher, canFlush := w.(http.Flusher)
	buf := make([]byte, 32*1024)
	var lineBuf bytes.Buffer
	var capturedUsage *usageInfo

	for {
		n, readErr := body.Read(buf)
		if n > 0 {
			_, _ = w.Write(buf[:n])
			if canFlush {
				flusher.Flush()
			}

			// Scan SSE data lines for usage
			lineBuf.Write(buf[:n])
			h.scanSSEForUsage(&lineBuf, &capturedUsage)
		}
		if readErr != nil {
			break
		}
	}

	// Process remaining buffer
	if lineBuf.Len() > 0 {
		h.extractUsageFromLine(lineBuf.String(), &capturedUsage)
	}

	return capturedUsage
}

// scanSSEForUsage processes buffered data looking for complete SSE lines containing usage.
func (h *ProxyHandler) scanSSEForUsage(lineBuf *bytes.Buffer, capturedUsage **usageInfo) {
	for {
		line, err := lineBuf.ReadString('\n')
		if err != nil {
			// Not a complete line, put it back
			lineBuf.WriteString(line)
			return
		}
		h.extractUsageFromLine(strings.TrimRight(line, "\r\n"), capturedUsage)
	}
}

// extractUsageFromLine checks a single SSE data line for usage info.
func (h *ProxyHandler) extractUsageFromLine(line string, capturedUsage **usageInfo) {
	// Only process lines like: data: {...}
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "data: ") {
		return
	}
	data := trimmed[6:]
	if !strings.Contains(data, `"usage"`) {
		return
	}
	// Try to parse the JSON and extract usage
	var wrapper struct {
		Usage *usageInfo `json:"usage"`
	}
	if json.Unmarshal([]byte(data), &wrapper) == nil && wrapper.Usage != nil && wrapper.Usage.TotalTokens != nil {
		*capturedUsage = wrapper.Usage
	}
}

func (h *ProxyHandler) logAndRecord(
	key *store.ApiKey,
	account *store.Account,
	r *http.Request,
	statusCode int,
	duration time.Duration,
	model *string,
	usage *usageInfo,
	firstTokenMs int64,
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
		FirstTokenMs: &firstTokenMs,
		CreatedAt:   nowISO(),
	}
	if usage != nil {
		logEntry.PromptTokens = usage.PromptTokens
		logEntry.CompletionTokens = usage.CompletionTokens
		logEntry.TotalTokens = usage.TotalTokens
	}
	store.AppendLog(logEntry)
}
