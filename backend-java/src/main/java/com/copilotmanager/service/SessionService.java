package com.copilotmanager.service;

import com.copilotmanager.config.AppProperties;
import com.copilotmanager.idgen.IdGen;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SessionService {

    private static final long SESSION_HOURS = 24;

    private record SessionEntry(String userId, String role, Instant expiresAt) {}

    private final Map<String, SessionEntry> sessions = new ConcurrentHashMap<>();
    private final AppProperties appProperties;

    public SessionService(AppProperties appProperties) {
        this.appProperties = appProperties;
    }

    public String createSession(String userId, String role) {
        String sessionId = IdGen.generateSessionId();
        Instant expiresAt = Instant.now().plus(SESSION_HOURS, ChronoUnit.HOURS);
        sessions.put(sessionId, new SessionEntry(userId, role, expiresAt));
        return sessionId;
    }

    public SessionEntry getSession(String sessionId) {
        if (sessionId == null) return null;
        SessionEntry entry = sessions.get(sessionId);
        if (entry == null) return null;
        if (Instant.now().isAfter(entry.expiresAt())) {
            sessions.remove(sessionId);
            return null;
        }
        return entry;
    }

    public void deleteSession(String sessionId) {
        if (sessionId != null) sessions.remove(sessionId);
    }

    public String getUserId(String sessionId) {
        SessionEntry e = getSession(sessionId);
        return e != null ? e.userId() : null;
    }

    public String getRole(String sessionId) {
        SessionEntry e = getSession(sessionId);
        return e != null ? e.role() : null;
    }

    public boolean isAdmin(String sessionId) {
        return "admin".equals(getRole(sessionId));
    }
}
