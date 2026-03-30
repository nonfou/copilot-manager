package com.copilotmanager.service;

import com.copilotmanager.model.Account;
import com.copilotmanager.repository.AccountRepository;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AccountService {

    private record CacheEntry(Object data, long fetchedAt) {}
    private static final long CACHE_TTL_MS = 5 * 60 * 1000L;

    private final Map<String, CacheEntry> usageCache = new ConcurrentHashMap<>();
    private final Map<String, CacheEntry> modelsCache = new ConcurrentHashMap<>();
    private final Map<String, CacheEntry> modelsCacheStale = new ConcurrentHashMap<>();

    private final AccountRepository accountRepository;

    public AccountService(AccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    public List<Account> getAll() {
        return accountRepository.findAllByOrderByCreatedAtAsc();
    }

    public List<Account> getByOwner(String ownerId) {
        return accountRepository.findByOwnerId(ownerId);
    }

    public Account getById(String id) {
        return accountRepository.findById(id).orElse(null);
    }

    public Account save(Account account) {
        return accountRepository.save(account);
    }

    public void delete(String id) {
        accountRepository.deleteById(id);
    }

    public long countAll() {
        return accountRepository.count();
    }

    // Usage cache
    public Object getUsageCache(String id) {
        CacheEntry e = usageCache.get(id);
        if (e == null || System.currentTimeMillis() - e.fetchedAt() > CACHE_TTL_MS) return null;
        return e.data();
    }
    public void setUsageCache(String id, Object data) {
        usageCache.put(id, new CacheEntry(data, System.currentTimeMillis()));
    }
    public void invalidateUsageCache(String id) { usageCache.remove(id); }

    // Models cache
    public Object getModelsCache(String id) {
        CacheEntry e = modelsCache.get(id);
        if (e == null || System.currentTimeMillis() - e.fetchedAt() > CACHE_TTL_MS) return null;
        return e.data();
    }
    public Object getModelsCacheStale(String id) {
        CacheEntry e = modelsCacheStale.get(id);
        return e != null ? e.data() : null;
    }
    public void setModelsCache(String id, Object data) {
        modelsCache.put(id, new CacheEntry(data, System.currentTimeMillis()));
        modelsCacheStale.put(id, new CacheEntry(data, System.currentTimeMillis()));
    }
    public void invalidateModelsCache(String id) { modelsCache.remove(id); }
}
