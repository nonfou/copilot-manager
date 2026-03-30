package com.copilotmanager.ratelimit;

import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;

/**
 * Login rate limiter: IP + username dual-dimension, 5 failures per 15 minutes.
 */
@Component
public class LoginRateLimiter {

    private static final int MAX_ATTEMPTS = 5;
    private static final long WINDOW_MS = 15 * 60 * 1000L;

    private record AttemptRecord(int count, long lockedUntil) {}

    private final ConcurrentHashMap<String, AttemptRecord> attempts = new ConcurrentHashMap<>();

    public boolean isBlocked(String ip, String username) {
        return isKeyBlocked(ip) || isKeyBlocked("user:" + username.toLowerCase());
    }

    public void recordFailure(String ip, String username) {
        recordKey(ip);
        recordKey("user:" + username.toLowerCase());
    }

    public void clearSuccess(String ip, String username) {
        attempts.remove(ip);
        attempts.remove("user:" + username.toLowerCase());
    }

    private boolean isKeyBlocked(String key) {
        AttemptRecord r = attempts.get(key);
        if (r == null) return false;
        long now = System.currentTimeMillis();
        if (now < r.lockedUntil()) return true;
        if (now > r.lockedUntil() && r.lockedUntil() > 0) {
            attempts.remove(key);
            return false;
        }
        return r.count() >= MAX_ATTEMPTS;
    }

    private void recordKey(String key) {
        long now = System.currentTimeMillis();
        attempts.compute(key, (k, r) -> {
            if (r == null) return new AttemptRecord(1, 0);
            // If lock already expired, reset
            if (r.lockedUntil() > 0 && now > r.lockedUntil()) {
                return new AttemptRecord(1, 0);
            }
            int newCount = r.count() + 1;
            long lockUntil = newCount >= MAX_ATTEMPTS ? now + WINDOW_MS : r.lockedUntil();
            return new AttemptRecord(newCount, lockUntil);
        });
    }
}
