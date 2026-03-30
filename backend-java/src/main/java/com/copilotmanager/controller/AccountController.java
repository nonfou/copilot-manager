package com.copilotmanager.controller;

import com.copilotmanager.idgen.IdGen;
import com.copilotmanager.model.Account;
import com.copilotmanager.model.User;
import com.copilotmanager.service.AccountService;
import com.copilotmanager.service.ApiKeyService;
import com.copilotmanager.ssrf.SsrfValidator;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/accounts")
public class AccountController {

    private static final Logger log = LoggerFactory.getLogger(AccountController.class);
    private static final String GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98";

    private final AccountService accountService;
    private final ApiKeyService apiKeyService;
    private final SsrfValidator ssrfValidator;

    // In-memory auth sessions for Device Flow
    private final ConcurrentHashMap<String, AuthSession> authSessions = new ConcurrentHashMap<>();

    private record AuthSession(String authId, String deviceCode, String name, String accountType,
                                String apiUrl, String ownerId, int interval, Instant expiresAt) {}

    public AccountController(AccountService accountService, ApiKeyService apiKeyService,
                              SsrfValidator ssrfValidator) {
        this.accountService = accountService;
        this.apiKeyService = apiKeyService;
        this.ssrfValidator = ssrfValidator;
    }

    @GetMapping
    public ResponseEntity<?> list(HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        boolean admin = "admin".equals(request.getAttribute("userRole"));
        List<Account> accounts = admin
                ? accountService.getAll()
                : accountService.getByOwner(user.getId());
        return ResponseEntity.ok(accounts.stream().map(AccountController::accountToMap).toList());
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody Map<String, String> body, HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        String name = body.get("name");
        String apiUrl = body.get("api_url");
        if (name == null || name.isBlank()) return ResponseEntity.badRequest().body(err("name is required"));
        if (apiUrl == null || apiUrl.isBlank()) return ResponseEntity.badRequest().body(err("api_url is required"));
        try { ssrfValidator.validate(apiUrl); } catch (Exception e) {
            return ResponseEntity.badRequest().body(err(e.getMessage()));
        }
        Account a = new Account();
        a.setId(IdGen.generateId("acc"));
        a.setName(name);
        a.setGithubToken(body.getOrDefault("github_token", ""));
        a.setAccountType(parseAccountType(body.get("account_type")));
        a.setApiUrl(stripTrailingSlash(apiUrl));
        a.setOwnerId(user.getId());
        a.setCreatedAt(Instant.now().toString());
        Account saved = accountService.save(a);
        return ResponseEntity.status(201).body(accountToMap(saved));
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable String id, @RequestBody Map<String, Object> body,
                                     HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        boolean admin = "admin".equals(request.getAttribute("userRole"));
        Account a = accountService.getById(id);
        if (a == null || (!admin && !a.getOwnerId().equals(user.getId()))) {
            return ResponseEntity.status(404).body(err("Account not found or no permission"));
        }
        if (body.containsKey("name") && body.get("name") != null)
            a.setName(body.get("name").toString());
        if (body.containsKey("github_token") && body.get("github_token") != null
                && !body.get("github_token").toString().isBlank())
            a.setGithubToken(body.get("github_token").toString());
        if (body.containsKey("account_type") && body.get("account_type") != null)
            a.setAccountType(parseAccountType(body.get("account_type").toString()));
        if (body.containsKey("api_url") && body.get("api_url") != null
                && !body.get("api_url").toString().isBlank()) {
            try { ssrfValidator.validate(body.get("api_url").toString()); } catch (Exception e) {
                return ResponseEntity.badRequest().body(err(e.getMessage()));
            }
            a.setApiUrl(stripTrailingSlash(body.get("api_url").toString()));
        }
        Account saved = accountService.save(a);
        accountService.invalidateUsageCache(id);
        accountService.invalidateModelsCache(id);
        return ResponseEntity.ok(accountToMap(saved));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id, HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        boolean admin = "admin".equals(request.getAttribute("userRole"));
        Account a = accountService.getById(id);
        if (a == null || (!admin && !a.getOwnerId().equals(user.getId()))) {
            return ResponseEntity.status(404).body(err("Account not found or no permission"));
        }
        String ownerFilter = admin ? null : user.getId();
        List<com.copilotmanager.model.ApiKey> keys = ownerFilter != null
                ? apiKeyService.getByOwnerAndAccount(ownerFilter, id)
                : apiKeyService.getByAccount(id);
        keys.forEach(k -> apiKeyService.delete(k.getId()));
        accountService.delete(id);
        accountService.invalidateUsageCache(id);
        accountService.invalidateModelsCache(id);
        return ResponseEntity.ok(Map.of("success", true));
    }

    @GetMapping("/{id}/usage")
    public ResponseEntity<?> getUsage(@PathVariable String id,
                                       @RequestParam(defaultValue = "false") boolean refresh,
                                       HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        boolean admin = "admin".equals(request.getAttribute("userRole"));
        Account a = accountService.getById(id);
        if (a == null) return ResponseEntity.status(404).body(err("Account not found"));
        if (!admin && !a.getOwnerId().equals(user.getId())) {
            if (apiKeyService.getByOwnerAndAccount(user.getId(), id).isEmpty())
                return ResponseEntity.status(404).body(err("Account not found or no permission"));
        }
        if (a.getApiUrl().isBlank()) return ResponseEntity.badRequest().body(err("Account has no api_url configured"));
        if (!refresh) {
            Object cached = accountService.getUsageCache(id);
            if (cached != null) return ResponseEntity.ok(cached);
        }
        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(java.net.URI.create(a.getApiUrl() + "/usage"))
                    .timeout(Duration.ofSeconds(10)).GET().build();
            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200)
                return ResponseEntity.status(502).body(err("Upstream returned " + resp.statusCode()));
            Object data = new com.fasterxml.jackson.databind.ObjectMapper().readValue(resp.body(), Object.class);
            accountService.setUsageCache(id, data);
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            log.warn("Usage fetch failed for {}: {}", id, e.getMessage());
            return ResponseEntity.status(502).body(err("Failed to fetch usage: " + e.getMessage()));
        }
    }

    @GetMapping("/{id}/models")
    public ResponseEntity<?> getModels(@PathVariable String id,
                                        @RequestParam(defaultValue = "false") boolean refresh,
                                        HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        boolean admin = "admin".equals(request.getAttribute("userRole"));
        Account a = accountService.getById(id);
        if (a == null) return ResponseEntity.status(404).body(err("Account not found"));
        if (!admin && !a.getOwnerId().equals(user.getId())) {
            if (apiKeyService.getByOwnerAndAccount(user.getId(), id).isEmpty())
                return ResponseEntity.status(404).body(err("Account not found or no permission"));
        }
        if (a.getApiUrl().isBlank())
            return ResponseEntity.status(503).body(err("Account has no api_url configured"));
        if (!refresh) {
            Object cached = accountService.getModelsCache(id);
            if (cached != null) return ResponseEntity.ok(cached);
        }
        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(java.net.URI.create(a.getApiUrl() + "/v1/models"))
                    .timeout(Duration.ofSeconds(10)).GET().build();
            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                Object stale = accountService.getModelsCacheStale(id);
                if (stale != null) return ResponseEntity.ok(stale);
                return ResponseEntity.status(502).body(err("Upstream returned " + resp.statusCode()));
            }
            Object data = new com.fasterxml.jackson.databind.ObjectMapper().readValue(resp.body(), Object.class);
            accountService.setModelsCache(id, data);
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            log.warn("Models fetch failed for {}: {}", id, e.getMessage());
            Object stale = accountService.getModelsCacheStale(id);
            if (stale != null) return ResponseEntity.ok(stale);
            return ResponseEntity.status(502).body(err("Failed to fetch models: " + e.getMessage()));
        }
    }

    @PostMapping("/auth/start")
    public ResponseEntity<?> authStart(@RequestBody Map<String, String> body, HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        String name = body.get("name");
        String apiUrl = body.get("api_url");
        if (name == null || name.isBlank() || apiUrl == null || apiUrl.isBlank()) {
            return ResponseEntity.badRequest().body(err("name and api_url are required"));
        }
        try { ssrfValidator.validate(apiUrl); } catch (Exception e) {
            return ResponseEntity.badRequest().body(err(e.getMessage()));
        }
        try {
            String reqBody = "{\"client_id\":\"" + GITHUB_CLIENT_ID + "\",\"scope\":\"read:user\"}";
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(java.net.URI.create("https://github.com/login/device/code"))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(reqBody))
                    .timeout(Duration.ofSeconds(10)).build();
            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) return ResponseEntity.status(502).body(err("Failed to start GitHub OAuth flow"));
            @SuppressWarnings("unchecked")
            Map<String, Object> ghData = new com.fasterxml.jackson.databind.ObjectMapper().readValue(resp.body(), Map.class);
            String deviceCode = (String) ghData.get("device_code");
            String userCode = (String) ghData.get("user_code");
            String verificationUri = (String) ghData.get("verification_uri");
            int expiresIn = ghData.containsKey("expires_in") ? ((Number)ghData.get("expires_in")).intValue() : 900;
            int interval = ghData.containsKey("interval") ? ((Number)ghData.get("interval")).intValue() : 5;
            if (interval <= 0) interval = 5;
            if (expiresIn <= 0) expiresIn = 900;
            String authId = IdGen.generateId("auth");
            authSessions.put(authId, new AuthSession(authId, deviceCode, name,
                    parseAccountType(body.get("account_type")), stripTrailingSlash(apiUrl),
                    user.getId(), interval, Instant.now().plusSeconds(expiresIn)));
            return ResponseEntity.ok(Map.of(
                    "auth_id", authId, "user_code", userCode,
                    "verification_uri", verificationUri,
                    "expires_in", expiresIn, "interval", interval));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(err(e.getMessage()));
        }
    }

    @GetMapping("/auth/poll/{authId}")
    public ResponseEntity<?> authPoll(@PathVariable String authId) {
        AuthSession session = authSessions.get(authId);
        if (session == null || Instant.now().isAfter(session.expiresAt())) {
            authSessions.remove(authId);
            return ResponseEntity.ok(Map.of("status", "expired"));
        }
        try {
            String reqBody = "{\"client_id\":\"" + GITHUB_CLIENT_ID + "\",\"device_code\":\""
                    + session.deviceCode() + "\",\"grant_type\":\"urn:ietf:params:oauth:grant-type:device_code\"}";
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(java.net.URI.create("https://github.com/login/oauth/access_token"))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(reqBody))
                    .timeout(Duration.ofSeconds(10)).build();
            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
            @SuppressWarnings("unchecked")
            Map<String, Object> data = new com.fasterxml.jackson.databind.ObjectMapper().readValue(resp.body(), Map.class);
            String error = (String) data.get("error");
            if ("authorization_pending".equals(error) || "slow_down".equals(error)) {
                return ResponseEntity.ok(Map.of("status", "pending"));
            }
            if ("expired_token".equals(error)) {
                authSessions.remove(authId);
                return ResponseEntity.ok(Map.of("status", "expired"));
            }
            String accessToken = (String) data.get("access_token");
            if (accessToken != null && !accessToken.isBlank()) {
                Account a = new Account();
                a.setId(IdGen.generateId("acc"));
                a.setName(session.name());
                a.setGithubToken(accessToken);
                a.setAccountType(session.accountType());
                a.setApiUrl(session.apiUrl());
                a.setOwnerId(session.ownerId());
                a.setCreatedAt(Instant.now().toString());
                Account saved = accountService.save(a);
                authSessions.remove(authId);
                return ResponseEntity.ok(Map.of("status", "success", "account", accountToMap(saved)));
            }
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("status", "error", "error", e.getMessage()));
        }
        return ResponseEntity.ok(Map.of("status", "pending"));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    static Map<String, Object> accountToMap(Account a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", a.getId());
        m.put("name", a.getName());
        m.put("github_token", maskToken(a.getGithubToken()));
        m.put("account_type", a.getAccountType());
        m.put("api_url", a.getApiUrl());
        m.put("owner_id", a.getOwnerId());
        m.put("created_at", a.getCreatedAt());
        return m;
    }

    private static String maskToken(String token) {
        if (token == null || token.isBlank()) return "";
        if (token.length() <= 8) return "****";
        return token.substring(0, 4) + "****" + token.substring(token.length() - 4);
    }

    private static String parseAccountType(String s) {
        if ("business".equals(s)) return "business";
        if ("enterprise".equals(s)) return "enterprise";
        return "individual";
    }

    private static String stripTrailingSlash(String url) {
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url;
    }

    static Map<String, String> err(String msg) { return Map.of("error", msg); }
}
