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

// usageInfo holds token usage extracted from the upstream response.
// Supports both Anthropic format (input_tokens/output_tokens) and OpenAI format (prompt_tokens/completion_tokens).
type usageInfo struct {
	// Anthropic format (copilot-api returns this)
	InputTokens  *int64 `json:"input_tokens"`
	OutputTokens *int64 `json:"output_tokens"`
	// OpenAI format (fallback)
	PromptTokens     *int64 `json:"prompt_tokens"`
	CompletionTokens *int64 `json:"completion_tokens"`
	TotalTokens      *int64 `json:"total_tokens"`
}

func (u *usageInfo) hasData() bool {
	return u.InputTokens != nil || u.OutputTokens != nil ||
		u.PromptTokens != nil || u.CompletionTokens != nil ||
		u.TotalTokens != nil
}

func (u *usageInfo) merge(other *usageInfo) {
	if other == nil {
		return
	}
	if other.InputTokens != nil {
		u.InputTokens = other.InputTokens
	}
	if other.OutputTokens != nil {
		u.OutputTokens = other.OutputTokens
	}
	if other.PromptTokens != nil {
		u.PromptTokens = other.PromptTokens
	}
	if other.CompletionTokens != nil {
		u.CompletionTokens = other.CompletionTokens
	}
	if other.TotalTokens != nil {
		u.TotalTokens = other.TotalTokens
	}
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
	if r.ContentLength > maxProxyBodySize {
		writeError(w, http.StatusRequestEntityTooLarge, "Request body too large")
		return
	}

	// Read body (for model extraction and forwarding)
	var bodyBytes []byte
	var model *string

	hasBody := r.Method != http.MethodGet && r.Method != http.MethodHead
	if hasBody && r.Body != nil {
		bodyBytes, _ = io.ReadAll(io.LimitReader(r.Body, maxProxyBodySize+1))
		if int64(len(bodyBytes)) > maxProxyBodySize {
			writeError(w, http.StatusRequestEntityTooLarge, "Request body too large")
			return
		}
		ct := r.Header.Get("Content-Type")
		if strings.Contains(ct, "application/json") && len(bodyBytes) > 0 {
			var mutated bool
			bodyBytes, model, mutated = enrichStreamingUsageRequest(r.URL.Path, bodyBytes)
			if !mutated && model == nil {
				var parsed struct {
					Model string `json:"model"`
				}
				if err := json.Unmarshal(bodyBytes, &parsed); err == nil && parsed.Model != "" {
					model = &parsed.Model
				}
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
		bodyReader = bytes.NewReader(bodyBytes)
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
	upstreamResp, err := proxyHTTPClient.Do(upstreamReq)
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

// bufferAndCapture streams the full non-SSE response to the client and only caches
// up to maxProxyBodySize bytes for usage extraction, avoiding large in-memory copies.
func (h *ProxyHandler) bufferAndCapture(w http.ResponseWriter, body io.Reader) *usageInfo {
	capture := &limitedCaptureBuffer{limit: maxProxyBodySize}
	writer := io.MultiWriter(w, capture)
	buf := make([]byte, 32*1024)

	if _, err := io.CopyBuffer(writer, body, buf); err != nil {
		return nil
	}

	if capture.overflow {
		return nil
	}

	bodyBytes := capture.Bytes()
	return parseUsagePayload(bodyBytes)
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
	usage := parseUsagePayload([]byte(data))
	if usage != nil {
		if *capturedUsage == nil {
			*capturedUsage = usage
			return
		}
		(*capturedUsage).merge(usage)
	}
}

func enrichStreamingUsageRequest(path string, bodyBytes []byte) ([]byte, *string, bool) {
	var payload map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		return bodyBytes, nil, false
	}

	var model *string
	if rawModel, ok := payload["model"].(string); ok && rawModel != "" {
		model = &rawModel
	}

	if !strings.HasSuffix(path, "/chat/completions") {
		return bodyBytes, model, false
	}

	stream, _ := payload["stream"].(bool)
	if !stream {
		return bodyBytes, model, false
	}

	streamOptions, hasStreamOptions := payload["stream_options"]
	if !hasStreamOptions || streamOptions == nil {
		payload["stream_options"] = map[string]interface{}{"include_usage": true}
		updated, err := json.Marshal(payload)
		if err != nil {
			return bodyBytes, model, false
		}
		return updated, model, true
	}

	if optionsMap, ok := streamOptions.(map[string]interface{}); ok {
		if _, exists := optionsMap["include_usage"]; !exists {
			optionsMap["include_usage"] = true
			payload["stream_options"] = optionsMap
			updated, err := json.Marshal(payload)
			if err != nil {
				return bodyBytes, model, false
			}
			return updated, model, true
		}
	}

	return bodyBytes, model, false
}

func parseUsagePayload(data []byte) *usageInfo {
	if len(data) == 0 {
		return nil
	}

	var wrapper struct {
		Usage   *usageInfo `json:"usage"`
		Message *struct {
			Usage *usageInfo `json:"usage"`
		} `json:"message"`
		Delta *struct {
			Usage *usageInfo `json:"usage"`
		} `json:"delta"`
	}
	if err := json.Unmarshal(data, &wrapper); err != nil {
		return nil
	}

	merged := &usageInfo{}
	if wrapper.Usage != nil {
		merged.merge(wrapper.Usage)
	}
	if wrapper.Message != nil && wrapper.Message.Usage != nil {
		merged.merge(wrapper.Message.Usage)
	}
	if wrapper.Delta != nil && wrapper.Delta.Usage != nil {
		merged.merge(wrapper.Delta.Usage)
	}

	if !merged.hasData() {
		return nil
	}

	if merged.TotalTokens == nil {
		promptTokens := coalesce(merged.InputTokens, merged.PromptTokens)
		completionTokens := coalesce(merged.OutputTokens, merged.CompletionTokens)
		if promptTokens != nil && completionTokens != nil {
			total := *promptTokens + *completionTokens
			merged.TotalTokens = &total
		}
	}

	return merged
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
		ID:           idgen.GenerateID("log"),
		ApiKeyID:     key.ID,
		AccountID:    account.ID,
		ApiKeyName:   key.Name,
		AccountName:  account.Name,
		Method:       r.Method,
		Path:         r.URL.Path,
		StatusCode:   statusCode,
		DurationMs:   duration.Milliseconds(),
		Model:        model,
		Error:        errPtr,
		FirstTokenMs: &firstTokenMs,
		CreatedAt:    nowISO(),
	}
	if usage != nil {
		promptTokens := coalesce(usage.InputTokens, usage.PromptTokens)
		completionTokens := coalesce(usage.OutputTokens, usage.CompletionTokens)
		logEntry.PromptTokens = promptTokens
		logEntry.CompletionTokens = completionTokens
		if usage.TotalTokens != nil {
			logEntry.TotalTokens = usage.TotalTokens
		} else if promptTokens != nil && completionTokens != nil {
			total := *promptTokens + *completionTokens
			logEntry.TotalTokens = &total
		}
	}
	store.AppendLog(logEntry)
}

type limitedCaptureBuffer struct {
	buf      bytes.Buffer
	limit    int64
	overflow bool
}

func (l *limitedCaptureBuffer) Write(p []byte) (int, error) {
	if l.limit <= 0 {
		l.overflow = true
		return len(p), nil
	}
	if l.overflow {
		return len(p), nil
	}

	remaining := l.limit - int64(l.buf.Len())
	if remaining <= 0 {
		l.overflow = true
		return len(p), nil
	}

	if int64(len(p)) > remaining {
		_, _ = l.buf.Write(p[:remaining])
		l.overflow = true
		return len(p), nil
	}

	return l.buf.Write(p)
}

func (l *limitedCaptureBuffer) Bytes() []byte {
	return l.buf.Bytes()
}

func coalesce(a, b *int64) *int64 {
	if a != nil {
		return a
	}
	return b
}
