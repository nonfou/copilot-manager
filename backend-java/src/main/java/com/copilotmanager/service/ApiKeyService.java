package com.copilotmanager.service;

import com.copilotmanager.idgen.IdGen;
import com.copilotmanager.model.ApiKey;
import com.copilotmanager.repository.ApiKeyRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

@Service
public class ApiKeyService {

    private final ApiKeyRepository apiKeyRepository;
    private final KeyCacheService keyCacheService;

    public ApiKeyService(ApiKeyRepository apiKeyRepository, KeyCacheService keyCacheService) {
        this.apiKeyRepository = apiKeyRepository;
        this.keyCacheService = keyCacheService;
    }

    public List<ApiKey> getAll() {
        return apiKeyRepository.findAll();
    }

    public List<ApiKey> getByOwner(String ownerId) {
        return apiKeyRepository.findByOwnerId(ownerId);
    }

    public List<ApiKey> getByAccount(String accountId) {
        return apiKeyRepository.findByAccountId(accountId);
    }

    public List<ApiKey> getByOwnerAndAccount(String ownerId, String accountId) {
        return apiKeyRepository.findByOwnerIdAndAccountId(ownerId, accountId);
    }

    public ApiKey getById(String id) {
        return apiKeyRepository.findById(id).orElse(null);
    }

    public ApiKey create(String name, String accountId, String ownerId) {
        String rawKey = IdGen.generateApiKey();
        ApiKey k = new ApiKey();
        k.setId(IdGen.generateId("key"));
        k.setKey(rawKey);
        k.setName(name);
        k.setAccountId(accountId);
        k.setOwnerId(ownerId);
        k.setEnabled(true);
        k.setRequestCount(0);
        k.setCreatedAt(Instant.now().toString());
        ApiKey saved = apiKeyRepository.save(k);
        // After save, decryptFields restores plaintext; cache with plaintext
        keyCacheService.addEntry(saved.getId(), rawKey, true, accountId);
        // Return with raw key visible
        saved.setKey(rawKey);
        return saved;
    }

    public ApiKey update(String id, String name, Boolean enabled) {
        ApiKey k = apiKeyRepository.findById(id).orElse(null);
        if (k == null) return null;
        if (name != null && !name.isBlank()) k.setName(name);
        if (enabled != null) k.setEnabled(enabled);
        ApiKey saved = apiKeyRepository.save(k);
        keyCacheService.updateEntry(id, null, saved.isEnabled());
        return saved;
    }

    public ApiKey regenerate(String id) {
        ApiKey k = apiKeyRepository.findById(id).orElse(null);
        if (k == null) return null;
        String rawKey = IdGen.generateApiKey();
        k.setKey(rawKey);
        ApiKey saved = apiKeyRepository.save(k);
        keyCacheService.updateEntry(id, rawKey, saved.isEnabled());
        saved.setKey(rawKey);
        return saved;
    }

    public boolean delete(String id) {
        if (!apiKeyRepository.existsById(id)) return false;
        apiKeyRepository.deleteById(id);
        keyCacheService.removeEntry(id);
        return true;
    }

    public String maskKey(String key) {
        if (key == null || key.isEmpty()) return "";
        if (key.length() <= 20) return "****";
        return key.substring(0, 16) + "..." + key.substring(key.length() - 4);
    }
}
