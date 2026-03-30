package com.copilotmanager.filter;

import com.copilotmanager.config.AppProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

@Component
@Order(2)
public class CorsFilter extends OncePerRequestFilter {

    private final AppProperties appProperties;
    private final Set<String> allowedOrigins;

    public CorsFilter(AppProperties appProperties) {
        this.appProperties = appProperties;
        String raw = appProperties.getCorsAllowedOrigins();
        if (raw != null && !raw.isBlank()) {
            allowedOrigins = new HashSet<>(Arrays.asList(raw.split(",")));
            allowedOrigins.removeIf(String::isBlank);
        } else {
            allowedOrigins = new HashSet<>();
        }
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String origin = request.getHeader("Origin");

        if (origin != null) {
            if (!appProperties.isProduction()) {
                // Dev mode: allow all
                setAllowOrigin(response, origin);
            } else if (!allowedOrigins.isEmpty() && allowedOrigins.contains(origin)) {
                setAllowOrigin(response, origin);
            } else if (!allowedOrigins.isEmpty()) {
                // Origin not in whitelist
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                return;
            }
            // Production + empty whitelist: block all (don't set header)
        }

        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            response.setStatus(HttpServletResponse.SC_OK);
            return;
        }

        chain.doFilter(request, response);
    }

    private void setAllowOrigin(HttpServletResponse response, String origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers",
                "Content-Type, Authorization, X-Session-Id");
        response.setHeader("Access-Control-Allow-Credentials", "true");
        response.setHeader("Access-Control-Max-Age", "86400");
    }
}
