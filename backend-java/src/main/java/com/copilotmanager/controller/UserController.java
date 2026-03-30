package com.copilotmanager.controller;

import com.copilotmanager.model.User;
import com.copilotmanager.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public ResponseEntity<?> list(HttpServletRequest request) {
        if (!requireAdmin(request)) return forbidden();
        User current = (User) request.getAttribute("user");
        List<User> users = userService.findAll();
        return ResponseEntity.ok(Map.of(
                "users", users.stream().map(AuthController::sanitizeUser).toList(),
                "current_user", AuthController.sanitizeUser(current),
                "total", users.size()
        ));
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody Map<String, String> body, HttpServletRequest request) {
        if (!requireAdmin(request)) return forbidden();
        User current = (User) request.getAttribute("user");
        String username = body.get("username");
        String password = body.get("password");
        String role = body.getOrDefault("role", "user");
        if (username == null || username.length() < 3 || username.length() > 32)
            return ResponseEntity.badRequest().body(err("username must be 3-32 characters"));
        if (password == null || password.length() < 6)
            return ResponseEntity.badRequest().body(err("password must be at least 6 characters"));
        if (!"admin".equals(role) && !"user".equals(role)) role = "user";
        if (userService.findByUsername(username) != null)
            return ResponseEntity.status(409).body(err("Username already exists"));
        User u = userService.createUser(username, password, role, current.getId());
        return ResponseEntity.status(201).body(AuthController.sanitizeUser(u));
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> get(@PathVariable String id, HttpServletRequest request) {
        if (!requireAdmin(request)) return forbidden();
        User u = userService.findById(id);
        if (u == null) return ResponseEntity.status(404).body(err("User not found"));
        return ResponseEntity.ok(AuthController.sanitizeUser(u));
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable String id, @RequestBody Map<String, String> body,
                                     HttpServletRequest request) {
        if (!requireAdmin(request)) return forbidden();
        User u = userService.findById(id);
        if (u == null) return ResponseEntity.status(404).body(err("User not found"));
        String username = body.get("username");
        String role = body.get("role");
        if (username != null && !username.isBlank()) {
            if (username.length() < 3 || username.length() > 32)
                return ResponseEntity.badRequest().body(err("username must be 3-32 characters"));
            User existing = userService.findByUsername(username);
            if (existing != null && !existing.getId().equals(id))
                return ResponseEntity.status(409).body(err("Username already exists"));
            u.setUsername(username);
        }
        if (role != null && ("admin".equals(role) || "user".equals(role))) u.setRole(role);
        User saved = userService.save(u);
        return ResponseEntity.ok(AuthController.sanitizeUser(saved));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id, HttpServletRequest request) {
        if (!requireAdmin(request)) return forbidden();
        User current = (User) request.getAttribute("user");
        if (current.getId().equals(id))
            return ResponseEntity.badRequest().body(err("Cannot delete yourself"));
        if (userService.findById(id) == null)
            return ResponseEntity.status(404).body(err("User not found"));
        userService.delete(id);
        return ResponseEntity.ok(Map.of());
    }

    @PostMapping("/{id}/reset-password")
    public ResponseEntity<?> resetPassword(@PathVariable String id, @RequestBody Map<String, String> body,
                                            HttpServletRequest request) {
        if (!requireAdmin(request)) return forbidden();
        String newPassword = body.get("new_password");
        if (newPassword == null || newPassword.length() < 6)
            return ResponseEntity.badRequest().body(err("new_password must be at least 6 characters"));
        if (userService.findById(id) == null)
            return ResponseEntity.status(404).body(err("User not found"));
        userService.resetPassword(id, newPassword);
        return ResponseEntity.ok(Map.of());
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    private boolean requireAdmin(HttpServletRequest request) {
        return "admin".equals(request.getAttribute("userRole"));
    }

    private ResponseEntity<Map<String, String>> forbidden() {
        return ResponseEntity.status(403).body(err("Admin access required"));
    }

    static Map<String, String> err(String msg) { return Map.of("error", msg); }
}
