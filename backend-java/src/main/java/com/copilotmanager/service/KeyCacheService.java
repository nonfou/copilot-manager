package com.copilotmanager.service;

import com.copilotmanager.model.Account;
import com.copilotmanager.model.ApiKey;
import com.copilotmanager.repository.ApiKeyRepository;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.locks.ReentrantReadWriteLock;

@Service
public class KeyCacheService {

    private static final Logger log = LoggerFactory.getLogger(KeyCacheService.class);

    private record KeyCacheEntry(String keyId, String keyVal, boolean enabled, String accountId) {}

    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();
    private List<KeyCacheEntry> cache = new ArrayList<>();

    private final ApiKeyRepository apiKeyRepository;
    private final AccountService accountService;

    public KeyCacheService(ApiKeyRepository apiKeyRepository, AccountService accountService) {
        this.apiKeyRepository = apiKeyRepository;
        this.accountService = accountService;
    }

    @PostConstruct
    public void rebuild() {
        List<ApiKey> keys = apiKeyRepository.findAll();
        List<KeyCacheEntry> newCache = new ArrayList<>(keys.size());
        for (ApiKey k : keys) {
            if (k.getKey() != null && !k.getKey().isBlank()) {
                newCache.add(new KeyCacheEntry(k.getId(), k.getKey(), k.isEnabled(), k.getAccountId()));
            }
        }
        lock.writeLock().lock();
        try {
            cache = newCache;
        } finally {
            lock.writeLock().unlock();
        }
        log.info("KeyCache rebuilt with {} entries", newCache.size());
    }

    /** Returns [ApiKey, Account] or null if not found/disabled */
    public Object[] findKeyWithAccount(String inputKey) {
        if (inputKey == null || inputKey.isBlank()) return null;
        byte[] inputBytes = inputKey.getBytes(java.nio.charset.StandardCharsets.US_ASCII);

        lock.readLock().lock();
        try {
            for (KeyCacheEntry entry : cache) {
                if (!entry.enabled()) continue;
                byte[] storedBytes = entry.keyVal().getBytes(java.nio.charset.StandardCharsets.US_ASCII);
                if (storedBytes.length != inputBytes.length) continue;
                if (MessageDigest.isEqual(inputBytes, storedBytes)) {
                    ApiKey key = apiKeyRepository.findById(entry.keyId()).orElse(null);
                    if (key == null || !key.isEnabled()) return null;
                    Account account = accountService.getById(key.getAccountId());
                    return new Object[]{key, account};
                }
            }
        } finally {
            lock.readLock().unlock();
        }
        return null;
    }

    public void addEntry(String keyId, String keyVal, boolean enabled, String accountId) {
        lock.writeLock().lock();
        try {
            cache = new ArrayList<>(cache);
            cache.add(new KeyCacheEntry(keyId, keyVal, enabled, accountId));
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void updateEntry(String keyId, String newVal, boolean enabled) {
        lock.writeLock().lock();
        try {
            List<KeyCacheEntry> updated = new ArrayList<>(cache.size());
            for (KeyCacheEntry e : cache) {
                if (e.keyId().equals(keyId)) {
                    updated.add(new KeyCacheEntry(keyId,
                            newVal != null ? newVal : e.keyVal(),
                            enabled, e.accountId()));
                } else {
                    updated.add(e);
                }
            }
            cache = updated;
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void removeEntry(String keyId) {
        lock.writeLock().lock();
        try {
            cache = cache.stream().filter(e -> !e.keyId().equals(keyId)).toList();
        } finally {
            lock.writeLock().unlock();
        }
    }
}
