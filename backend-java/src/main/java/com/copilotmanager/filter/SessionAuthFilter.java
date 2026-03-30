package com.copilotmanager.filter;

import com.copilotmanager.service.SessionService;
import com.copilotmanager.service.UserService;
import com.copilotmanager.model.User;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.Set;

@Component
@Order(3)
public class SessionAuthFilter extends OncePerRequestFilter {

    // Paths that require auth (all /api/** except these public ones)
    private static final Set<String> PUBLIC_PATHS = Set.of(
            "/api/auth/status",
            "/api/auth/login",
            "/api/auth/logout",
            "/api/auth/setup"
    );

    private final SessionService sessionService;
    private final UserService userService;

    public SessionAuthFilter(SessionService sessionService, UserService userService) {
        this.sessionService = sessionService;
        this.userService = userService;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String uri = request.getRequestURI();
        // Only apply to /api/** (but not public paths)
        if (!uri.startsWith("/api/")) return true;
        return PUBLIC_PATHS.contains(uri);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String sessionId = extractSessionId(request);
        if (sessionId == null) {
            sendUnauthorized(response);
            return;
        }

        String userId = sessionService.getUserId(sessionId);
        if (userId == null) {
            sendUnauthorized(response);
            return;
        }

        User user = userService.findById(userId);
        if (user == null) {
            sendUnauthorized(response);
            return;
        }

        request.setAttribute("userId", user.getId());
        request.setAttribute("userRole", user.getRole());
        request.setAttribute("user", user);
        chain.doFilter(request, response);
    }

    private String extractSessionId(HttpServletRequest request) {
        // Priority: Cookie > X-Session-Id header > session_id query param
        if (request.getCookies() != null) {
            for (Cookie c : request.getCookies()) {
                if ("cm_session".equals(c.getName())) return c.getValue();
            }
        }
        String header = request.getHeader("X-Session-Id");
        if (header != null && !header.isBlank()) return header;

        // Also support Authorization: Bearer <session_id>
        String auth = request.getHeader("Authorization");
        if (auth != null && auth.startsWith("Bearer ")) {
            String token = auth.substring(7).trim();
            // Only treat as session if it looks like a session ID (hex, not api key)
            if (token.matches("[0-9a-f]{32}")) return token;
        }

        String query = request.getParameter("session_id");
        if (query != null && !query.isBlank()) return query;
        return null;
    }

    private void sendUnauthorized(HttpServletResponse response) throws IOException {
        response.setContentType("application/json");
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.getWriter().write("{\"error\":\"Not authenticated\"}");
    }
}
