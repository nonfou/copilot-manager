package com.copilotmanager.controller;

import com.copilotmanager.idgen.IdGen;
import com.copilotmanager.model.Account;
import com.copilotmanager.model.ApiKey;
import com.copilotmanager.model.RequestLog;
import com.copilotmanager.ratelimit.ProxyRateLimiter;
import com.copilotmanager.service.KeyCacheService;
import com.copilotmanager.service.LogService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;

@RestController
public class ProxyController {

    private static final Logger log = LoggerFactory.getLogger(ProxyController.class);
    private static final long MAX_BODY_SIZE = 100L * 1024 * 1024; // 100MB
    private static final Set<String> SKIP_HEADERS = Set.of(
            "authorization", "host", "content-length", "content-encoding", "transfer-encoding"
    );

    private final KeyCacheService keyCacheService;
    private final ProxyRateLimiter rateLimiter;
    private final LogService logService;
    private final ObjectMapper mapper = new ObjectMapper();

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    public ProxyController(KeyCacheService keyCacheService, ProxyRateLimiter rateLimiter,
                           LogService logService) {
        this.keyCacheService = keyCacheService;
        this.rateLimiter = rateLimiter;
        this.logService = logService;
    }

    @RequestMapping("/v1/**")
    public void proxy(HttpServletRequest request, HttpServletResponse response) throws IOException {
        long startMs = System.currentTimeMillis();

        // Extract method and path before any async usage
        final String reqMethod = request.getMethod();
        final String reqPath = request.getRequestURI();

        // ── 1. Extract Bearer token ─────────────────────────────────────
        String authHeader = request.getHeader("Authorization");
        String apiKey = null;
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            apiKey = authHeader.substring(7).strip();
        }
        if (apiKey == null || apiKey.isBlank()) {
            writeError(response, 401, "Missing Authorization header");
            return;
        }

        // ── 2. Find key + account ───────────────────────────────────────
        Object[] keyAndAccount = keyCacheService.findKeyWithAccount(apiKey);
        if (keyAndAccount == null) {
            writeError(response, 401, "Invalid API key");
            return;
        }
        ApiKey key = (ApiKey) keyAndAccount[0];
        Account account = (Account) keyAndAccount[1];
        if (account == null) {
            writeError(response, 404, "Account not found");
            return;
        }
        if (account.getApiUrl() == null || account.getApiUrl().isBlank()) {
            writeError(response, 503, "Account \"" + account.getName() + "\" has no api_url configured");
            return;
        }

        // ── 3. Rate limit ───────────────────────────────────────────────
        boolean[] allowed = rateLimiter.allow(key.getId());
        if (!allowed[0]) {
            response.setHeader("Retry-After", String.valueOf(rateLimiter.getRetryAfter(key.getId())));
            writeError(response, 429, "Rate limit exceeded");
            return;
        }

        // ── 4. Read request body (limit 100MB) ──────────────────────────
        byte[] bodyBytes = new byte[0];
        String model = null;
        if (!"GET".equalsIgnoreCase(request.getMethod()) && !"HEAD".equalsIgnoreCase(request.getMethod())) {
            long contentLength = request.getContentLengthLong();
            if (contentLength > MAX_BODY_SIZE) {
                writeError(response, 413, "Request body too large");
                return;
            }
            InputStream limited = new LimitedInputStream(request.getInputStream(), MAX_BODY_SIZE + 1);
            bodyBytes = limited.readAllBytes();
            if (bodyBytes.length > MAX_BODY_SIZE) {
                writeError(response, 413, "Request body too large");
                return;
            }
            String ct = request.getContentType();
            if (ct != null && ct.contains("application/json") && bodyBytes.length > 0) {
                try {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> parsed = mapper.readValue(bodyBytes, Map.class);
                    Object m = parsed.get("model");
                    if (m != null) model = m.toString();
                } catch (Exception ignored) {}
            }
        }

        // ── 5. Build upstream URL ───────────────────────────────────────
        String base = account.getApiUrl().stripTrailing();
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        String upstreamUrl = base + request.getRequestURI()
                + (request.getQueryString() != null ? "?" + request.getQueryString() : "");

        // ── 6. Build upstream request ───────────────────────────────────
        HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                .uri(URI.create(upstreamUrl))
                .timeout(Duration.ofSeconds(600));

        // Copy headers
        for (Enumeration<String> headers = request.getHeaderNames(); headers.hasMoreElements();) {
            String name = headers.nextElement();
            if (SKIP_HEADERS.contains(name.toLowerCase())) continue;
            reqBuilder.header(name, request.getHeader(name));
        }

        // Body (Content-Length is restricted in Java HttpClient, set automatically)
        HttpRequest.BodyPublisher publisher = bodyBytes.length > 0
                ? HttpRequest.BodyPublishers.ofByteArray(bodyBytes)
                : HttpRequest.BodyPublishers.noBody();
        reqBuilder.method(request.getMethod(), publisher);

        HttpRequest upstreamReq = reqBuilder.build();

        // ── 7. Execute request ──────────────────────────────────────────
        HttpResponse<InputStream> upstreamResp;
        try {
            upstreamResp = httpClient.send(upstreamReq, HttpResponse.BodyHandlers.ofInputStream());
        } catch (Exception e) {
            log.info("Proxy upstream error for account {}: {}", account.getId(), e.getMessage());
            long dur = System.currentTimeMillis() - startMs;
            final String errMsg = e.getMessage();
            final String modelFinal = model;
            CompletableFuture.runAsync(() ->
                logAsync(key, account, reqMethod, reqPath, 502, dur, modelFinal, null, 0, errMsg));
            writeError(response, 502, "Upstream service unavailable");
            return;
        }

        long firstTokenMs = System.currentTimeMillis() - startMs;

        // ── 8. Copy response headers (skip content-encoding, transfer-encoding) ─
        response.setStatus(upstreamResp.statusCode());
        upstreamResp.headers().map().forEach((k, vals) -> {
            String lower = k.toLowerCase();
            if (SKIP_HEADERS.contains(lower)) return;
            vals.forEach(v -> response.addHeader(k, v));
        });

        boolean isSSE = Optional.ofNullable(response.getHeader("Content-Type"))
                .map(c -> c.toLowerCase().contains("text/event-stream"))
                .orElse(false);

        if (isSSE) {
            response.setHeader("X-Accel-Buffering", "no");
        }

        // ── 9. Stream response ──────────────────────────────────────────
        UsageInfo usage;
        try (InputStream upstream = upstreamResp.body();
             OutputStream out = response.getOutputStream()) {
            if (isSSE) {
                usage = streamSSE(upstream, out, response);
            } else {
                usage = bufferAndCapture(upstream, out);
            }
        } catch (IOException e) {
            log.debug("Client disconnected during proxy: {}", e.getMessage());
            usage = null;
        }

        long durationMs = System.currentTimeMillis() - startMs;
        final UsageInfo usageFinal = usage;
        final String modelFinal = model;
        final long ftMs = firstTokenMs;
        CompletableFuture.runAsync(() ->
            logAsync(key, account, reqMethod, reqPath, upstreamResp.statusCode(), durationMs, modelFinal, usageFinal, ftMs, ""));
    }

    // ─── SSE stream with real-time flush ──────────────────────────────────

    private UsageInfo streamSSE(InputStream upstream, OutputStream out, HttpServletResponse response) throws IOException {
        byte[] buf = new byte[32768];
        StringBuilder lineBuf = new StringBuilder();
        UsageInfo[] usage = {null};

        int n;
        while ((n = upstream.read(buf)) != -1) {
            out.write(buf, 0, n);
            response.flushBuffer();

            // Scan for usage in SSE lines
            String chunk = new String(buf, 0, n, java.nio.charset.StandardCharsets.UTF_8);
            lineBuf.append(chunk);
            int newline;
            while ((newline = lineBuf.indexOf("\n")) >= 0) {
                String line = lineBuf.substring(0, newline).stripTrailing();
                lineBuf.delete(0, newline + 1);
                extractUsageFromLine(line, usage);
            }
        }
        // Process remaining
        if (lineBuf.length() > 0) extractUsageFromLine(lineBuf.toString().strip(), usage);
        return usage[0];
    }

    // ─── Buffered non-SSE response ─────────────────────────────────────────

    private UsageInfo bufferAndCapture(InputStream upstream, OutputStream out) throws IOException {
        byte[] body = upstream.readNBytes((int) MAX_BODY_SIZE + 1);
        out.write(body);
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = mapper.readValue(body, Map.class);
            Object usageObj = parsed.get("usage");
            if (usageObj instanceof Map) {
                return parseUsageMap((Map<?, ?>) usageObj);
            }
        } catch (Exception ignored) {}
        return null;
    }

    // ─── Usage extraction ──────────────────────────────────────────────────

    private void extractUsageFromLine(String line, UsageInfo[] usage) {
        if (!line.startsWith("data: ")) return;
        String data = line.substring(6);
        if (!data.contains("\"usage\"")) return;
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = mapper.readValue(data, Map.class);
            Object usageObj = parsed.get("usage");
            if (usageObj instanceof Map) {
                UsageInfo u = parseUsageMap((Map<?, ?>) usageObj);
                if (u != null) usage[0] = u;
            }
        } catch (Exception ignored) {}
    }

    private UsageInfo parseUsageMap(Map<?, ?> m) {
        Long inputTokens = toLong(m.get("input_tokens"));
        Long outputTokens = toLong(m.get("output_tokens"));
        Long promptTokens = toLong(m.get("prompt_tokens"));
        Long completionTokens = toLong(m.get("completion_tokens"));
        Long totalTokens = toLong(m.get("total_tokens"));
        if (inputTokens == null && outputTokens == null && promptTokens == null && completionTokens == null)
            return null;
        return new UsageInfo(inputTokens, outputTokens, promptTokens, completionTokens, totalTokens);
    }

    private Long toLong(Object v) {
        if (v == null) return null;
        if (v instanceof Number) return ((Number) v).longValue();
        return null;
    }

    // ─── Async logging ──────────────────────────────────────────────────────

    private void logAsync(ApiKey key, Account account, String method, String path,
                          int statusCode, long durationMs, String model,
                          UsageInfo usage, long firstTokenMs, String errMsg) {
        try {
            logService.incrementKeyRequestCount(key.getId());

            RequestLog entry = new RequestLog();
            entry.setId(IdGen.generateId("log"));
            entry.setApiKeyId(key.getId());
            entry.setAccountId(account.getId());
            entry.setApiKeyName(key.getName());
            entry.setAccountName(account.getName());
            entry.setMethod(method);
            entry.setPath(path);
            entry.setStatusCode(statusCode);
            entry.setDurationMs(durationMs);
            entry.setModel(model);
            entry.setError(errMsg == null || errMsg.isBlank() ? null : errMsg);
            entry.setFirstTokenMs(firstTokenMs > 0 ? firstTokenMs : null);
            entry.setCreatedAt(Instant.now().toString());

            if (usage != null) {
                Long prompt = coalesce(usage.inputTokens(), usage.promptTokens());
                Long completion = coalesce(usage.outputTokens(), usage.completionTokens());
                entry.setPromptTokens(prompt);
                entry.setCompletionTokens(completion);
                if (usage.totalTokens() != null) {
                    entry.setTotalTokens(usage.totalTokens());
                } else if (prompt != null && completion != null) {
                    entry.setTotalTokens(prompt + completion);
                }
            }

            logService.appendLog(entry);
        } catch (Exception e) {
            log.error("Failed to log request: {}", e.getMessage());
        }
    }

    private Long coalesce(Long a, Long b) { return a != null ? a : b; }

    private void writeError(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"" + message + "\"}");
    }

    // ─── DTOs ──────────────────────────────────────────────────────────────

    record UsageInfo(Long inputTokens, Long outputTokens, Long promptTokens,
                     Long completionTokens, Long totalTokens) {}

    // ─── Limited InputStream ───────────────────────────────────────────────

    static class LimitedInputStream extends FilterInputStream {
        private long remaining;
        LimitedInputStream(InputStream in, long limit) {
            super(in);
            this.remaining = limit;
        }
        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int b = super.read();
            if (b >= 0) remaining--;
            return b;
        }
        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            if (remaining <= 0) return -1;
            len = (int) Math.min(len, remaining);
            int n = super.read(buf, off, len);
            if (n > 0) remaining -= n;
            return n;
        }
    }
}
