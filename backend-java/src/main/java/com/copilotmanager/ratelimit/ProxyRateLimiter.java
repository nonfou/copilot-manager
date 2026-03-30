package com.copilotmanager.ratelimit;

import com.copilotmanager.config.AppProperties;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-API-key fixed window rate limiter.
 */
@Component
public class ProxyRateLimiter {

    private record WindowRecord(long windowStart, int count) {}

    private final ConcurrentHashMap<String, WindowRecord> records = new ConcurrentHashMap<>();
    private final int limitPerMin;

    public ProxyRateLimiter(AppProperties appProperties) {
        this.limitPerMin = appProperties.getRateLimitPerMinute();
    }

    /** Returns [allowed, retryAfterSeconds] */
    public boolean[] allow(String keyId) {
        if (limitPerMin <= 0) return new boolean[]{true};

        long now = System.currentTimeMillis();
        long[] retryAfter = {0};
        boolean[] allowed = {false};

        records.compute(keyId, (k, r) -> {
            if (r == null || now - r.windowStart() >= 60_000L) {
                allowed[0] = true;
                return new WindowRecord(now, 1);
            }
            if (r.count() < limitPerMin) {
                allowed[0] = true;
                return new WindowRecord(r.windowStart(), r.count() + 1);
            }
            retryAfter[0] = (60_000L - (now - r.windowStart())) / 1000 + 1;
            allowed[0] = false;
            return r;
        });
        return allowed;
    }

    public int getRetryAfter(String keyId) {
        WindowRecord r = records.get(keyId);
        if (r == null) return 0;
        long remaining = 60_000L - (System.currentTimeMillis() - r.windowStart());
        return remaining > 0 ? (int)(remaining / 1000) + 1 : 0;
    }
}
