package com.copilotmanager.model;

import com.copilotmanager.crypto.EncryptionService;
import jakarta.persistence.*;

@Entity
@Table(name = "api_keys")
public class ApiKey {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "key", nullable = false)
    private String key;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "account_id", nullable = false)
    private String accountId;

    @Column(name = "owner_id", nullable = false)
    private String ownerId;

    @Column(name = "enabled", nullable = false)
    private boolean enabled = true;

    @Column(name = "request_count", nullable = false)
    private long requestCount = 0;

    @Column(name = "last_used_at")
    private String lastUsedAt;

    @Column(name = "created_at", nullable = false)
    private String createdAt;

    @PrePersist
    @PreUpdate
    void encryptFields() {
        if (key != null && !key.isEmpty() && !key.startsWith("enc:")) {
            key = EncryptionService.encryptStatic(key);
        }
    }

    @PostLoad
    @PostPersist
    @PostUpdate
    void decryptFields() {
        if (key != null && key.startsWith("enc:")) {
            key = EncryptionService.decryptStatic(key);
        }
    }

    // Getters & Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getKey() { return key; }
    public void setKey(String key) { this.key = key; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getAccountId() { return accountId; }
    public void setAccountId(String accountId) { this.accountId = accountId; }
    public String getOwnerId() { return ownerId; }
    public void setOwnerId(String ownerId) { this.ownerId = ownerId; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public long getRequestCount() { return requestCount; }
    public void setRequestCount(long requestCount) { this.requestCount = requestCount; }
    public String getLastUsedAt() { return lastUsedAt; }
    public void setLastUsedAt(String lastUsedAt) { this.lastUsedAt = lastUsedAt; }
    public String getCreatedAt() { return createdAt; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }
}
