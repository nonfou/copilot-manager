package com.copilotmanager.controller;

import com.copilotmanager.model.Account;
import com.copilotmanager.model.ApiKey;
import com.copilotmanager.model.User;
import com.copilotmanager.service.AccountService;
import com.copilotmanager.service.ApiKeyService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/keys")
public class ApiKeyController {

    private final ApiKeyService apiKeyService;
    private final AccountService accountService;

    public ApiKeyController(ApiKeyService apiKeyService, AccountService accountService) {
        this.apiKeyService = apiKeyService;
        this.accountService = accountService;
    }

    @GetMapping
    public ResponseEntity<?> list(@RequestParam(required = false) String account_id,
                                   HttpServletRequest request) {
        boolean admin = "admin".equals(request.getAttribute("userRole"));
        User user = (User) request.getAttribute("user");

        List<ApiKey> keys;
        if (account_id != null && !account_id.isBlank()) {
            keys = admin
                    ? apiKeyService.getByAccount(account_id)
                    : apiKeyService.getByOwnerAndAccount(user.getId(), account_id);
        } else {
            keys = admin ? apiKeyService.getAll() : apiKeyService.getByOwner(user.getId());
        }
        return ResponseEntity.ok(keys.stream().map(k -> keyToMap(k, null, false)).toList());
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        String name = (String) body.get("name");
        String accountId = (String) body.get("account_id");
        if (name == null || name.isBlank()) return ResponseEntity.badRequest().body(err("name is required"));
        if (accountId == null || accountId.isBlank()) return ResponseEntity.badRequest().body(err("account_id is required"));

        Account account = accountService.getById(accountId);
        if (account == null) return ResponseEntity.status(404).body(err("Account not found"));

        String ownerId = body.containsKey("owner_id") && body.get("owner_id") != null
                ? body.get("owner_id").toString()
                : user.getId();

        ApiKey key = apiKeyService.create(name, accountId, ownerId);
        // Return with full key
        return ResponseEntity.status(201).body(keyToMap(key, key.getKey(), true));
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> get(@PathVariable String id, HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        boolean admin = "admin".equals(request.getAttribute("userRole"));
        ApiKey key = apiKeyService.getById(id);
        if (key == null || (!admin && !key.getOwnerId().equals(user.getId()))) {
            return ResponseEntity.status(404).body(err("Key not found or no permission"));
        }
        Account account = accountService.getById(key.getAccountId());
        return ResponseEntity.ok(keyToMap(key, null, false, account));
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable String id, @RequestBody Map<String, Object> body,
                                     HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        boolean admin = "admin".equals(request.getAttribute("userRole"));
        ApiKey key = apiKeyService.getById(id);
        if (key == null || (!admin && !key.getOwnerId().equals(user.getId()))) {
            return ResponseEntity.status(404).body(err("Key not found or no permission"));
        }
        String name = body.containsKey("name") ? (String) body.get("name") : null;
        Boolean enabled = body.containsKey("enabled") ? (Boolean) body.get("enabled") : null;
        ApiKey updated = apiKeyService.update(id, name, enabled);
        return ResponseEntity.ok(keyToMap(updated, null, false));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id, HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        boolean admin = "admin".equals(request.getAttribute("userRole"));
        ApiKey key = apiKeyService.getById(id);
        if (key == null || (!admin && !key.getOwnerId().equals(user.getId()))) {
            return ResponseEntity.status(404).body(err("Key not found or no permission"));
        }
        apiKeyService.delete(id);
        return ResponseEntity.ok(Map.of());
    }

    @PostMapping("/{id}/regenerate")
    public ResponseEntity<?> regenerate(@PathVariable String id, HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        boolean admin = "admin".equals(request.getAttribute("userRole"));
        ApiKey key = apiKeyService.getById(id);
        if (key == null || (!admin && !key.getOwnerId().equals(user.getId()))) {
            return ResponseEntity.status(404).body(err("Key not found or no permission"));
        }
        ApiKey regen = apiKeyService.regenerate(id);
        return ResponseEntity.ok(keyToMap(regen, regen.getKey(), true));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    static Map<String, Object> keyToMap(ApiKey k, String rawKey, boolean showFull) {
        return keyToMap(k, rawKey, showFull, null);
    }

    static Map<String, Object> keyToMap(ApiKey k, String rawKey, boolean showFull, Account account) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", k.getId());
        m.put("name", k.getName());
        String displayKey = k.getKey() != null && !k.getKey().isBlank() ? k.getKey() : "";
        if (showFull && rawKey != null) {
            m.put("key", rawKey);
            m.put("masked_key", maskKey(rawKey));
        } else {
            m.put("masked_key", maskKey(displayKey));
        }
        m.put("account_id", k.getAccountId());
        m.put("owner_id", k.getOwnerId());
        m.put("enabled", k.isEnabled());
        m.put("request_count", k.getRequestCount());
        m.put("last_used_at", k.getLastUsedAt());
        m.put("created_at", k.getCreatedAt());
        if (account != null) {
            m.put("account", AccountController.accountToMap(account));
        }
        return m;
    }

    private static String maskKey(String key) {
        if (key == null || key.isBlank()) return "";
        if (key.length() <= 20) return "****";
        return key.substring(0, 16) + "..." + key.substring(key.length() - 4);
    }

    static Map<String, String> err(String msg) { return Map.of("error", msg); }
}
