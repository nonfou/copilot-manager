package com.copilotmanager.controller;

import com.copilotmanager.config.AppProperties;
import com.copilotmanager.model.SystemConfig;
import com.copilotmanager.model.User;
import com.copilotmanager.ratelimit.LoginRateLimiter;
import com.copilotmanager.repository.SystemConfigRepository;
import com.copilotmanager.service.SessionService;
import com.copilotmanager.service.UserService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserService userService;
    private final SessionService sessionService;
    private final LoginRateLimiter loginRateLimiter;
    private final SystemConfigRepository systemConfigRepository;
    private final AppProperties appProperties;

    public AuthController(UserService userService, SessionService sessionService,
                          LoginRateLimiter loginRateLimiter,
                          SystemConfigRepository systemConfigRepository,
                          AppProperties appProperties) {
        this.userService = userService;
        this.sessionService = sessionService;
        this.loginRateLimiter = loginRateLimiter;
        this.systemConfigRepository = systemConfigRepository;
        this.appProperties = appProperties;
    }

    @GetMapping("/status")
    public Map<String, Object> status(HttpServletRequest request) {
        SystemConfig cfg = systemConfigRepository.findById(1).orElse(null);
        boolean initialized = cfg != null && cfg.isInitialized();

        // Check current session
        String sessionId = extractSessionId(request);
        User current = null;
        if (sessionId != null) {
            String userId = sessionService.getUserId(sessionId);
            if (userId != null) current = userService.findById(userId);
        }

        if (current != null) {
            return Map.of("initialized", initialized, "user", sanitizeUser(current));
        }
        Map<String, Object> result = new java.util.HashMap<>();
        result.put("initialized", initialized);
        result.put("user", null);
        return result;
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> body,
                                    HttpServletRequest request,
                                    HttpServletResponse response) {
        String username = body.get("username");
        String password = body.get("password");
        if (username == null || password == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "username and password required"));
        }

        String clientIp = getClientIp(request);
        if (loginRateLimiter.isBlocked(clientIp, username)) {
            return ResponseEntity.status(429).body(Map.of("error", "Too many login attempts. Try again later."));
        }

        User user = userService.findByUsername(username);
        if (user == null || !userService.verifyPassword(password, user.getPasswordHash())) {
            loginRateLimiter.recordFailure(clientIp, username);
            return ResponseEntity.status(401).body(Map.of("error", "Invalid credentials"));
        }

        loginRateLimiter.clearSuccess(clientIp, username);

        // Update last login
        user.setLastLoginAt(Instant.now().toString());
        userService.save(user);

        String sessionId = sessionService.createSession(user.getId(), user.getRole());
        Cookie cookie = new Cookie("cm_session", sessionId);
        cookie.setHttpOnly(true);
        cookie.setPath("/");
        cookie.setMaxAge(24 * 3600);
        cookie.setAttribute("SameSite", "Lax");
        if (appProperties.isSecureCookie()) cookie.setSecure(true);
        response.addCookie(cookie);

        return ResponseEntity.ok(sanitizeUser(user));
    }

    @PostMapping("/logout")
    public ResponseEntity<?> logout(HttpServletRequest request, HttpServletResponse response) {
        String sessionId = extractSessionId(request);
        if (sessionId != null) sessionService.deleteSession(sessionId);

        Cookie cookie = new Cookie("cm_session", "");
        cookie.setHttpOnly(true);
        cookie.setPath("/");
        cookie.setMaxAge(0);
        response.addCookie(cookie);
        return ResponseEntity.ok(Map.of());
    }

    @GetMapping("/me")
    public ResponseEntity<?> me(HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        if (user == null) return ResponseEntity.status(401).body(Map.of("error", "Not authenticated"));
        return ResponseEntity.ok(sanitizeUser(user));
    }

    @PostMapping("/change-password")
    public ResponseEntity<?> changePassword(@RequestBody Map<String, String> body,
                                             HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        if (user == null) return ResponseEntity.status(401).body(Map.of("error", "Not authenticated"));
        String oldPw = body.get("old_password");
        String newPw = body.get("new_password");
        if (oldPw == null || newPw == null || newPw.length() < 6) {
            return ResponseEntity.badRequest().body(Map.of("error", "new_password must be at least 6 characters"));
        }
        if (!userService.changePassword(user.getId(), oldPw, newPw)) {
            return ResponseEntity.status(401).body(Map.of("error", "Old password is incorrect"));
        }
        return ResponseEntity.ok(Map.of());
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    static Map<String, Object> sanitizeUser(User u) {
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", u.getId());
        m.put("username", u.getUsername());
        m.put("role", u.getRole());
        m.put("created_at", u.getCreatedAt());
        m.put("created_by", u.getCreatedBy());
        m.put("last_login_at", u.getLastLoginAt());
        return m;
    }

    static String extractSessionId(HttpServletRequest request) {
        if (request.getCookies() != null) {
            for (Cookie c : request.getCookies()) {
                if ("cm_session".equals(c.getName())) return c.getValue();
            }
        }
        String header = request.getHeader("X-Session-Id");
        if (header != null && !header.isBlank()) return header;
        String param = request.getParameter("session_id");
        if (param != null && !param.isBlank()) return param;
        return null;
    }

    private String getClientIp(HttpServletRequest request) {
        if (appProperties.isTrustedProxy()) {
            String xff = request.getHeader("X-Forwarded-For");
            if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
            String xri = request.getHeader("X-Real-IP");
            if (xri != null && !xri.isBlank()) return xri;
        }
        return request.getRemoteAddr();
    }
}
