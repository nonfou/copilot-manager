package com.copilotmanager.model;

import com.copilotmanager.crypto.EncryptionService;
import jakarta.persistence.*;

@Entity
@Table(name = "accounts")
public class Account {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "github_token", nullable = false)
    private String githubToken = "";

    @Column(name = "account_type", nullable = false)
    private String accountType = "individual";

    @Column(name = "api_url", nullable = false)
    private String apiUrl = "";

    @Column(name = "owner_id", nullable = false)
    private String ownerId;

    @Column(name = "created_at", nullable = false)
    private String createdAt;

    @PrePersist
    @PreUpdate
    void encryptFields() {
        if (githubToken != null && !githubToken.isEmpty() && !githubToken.startsWith("enc:")) {
            githubToken = EncryptionService.encryptStatic(githubToken);
        }
    }

    @PostLoad
    @PostPersist
    @PostUpdate
    void decryptFields() {
        if (githubToken != null && githubToken.startsWith("enc:")) {
            githubToken = EncryptionService.decryptStatic(githubToken);
        }
    }

    // Getters & Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getGithubToken() { return githubToken; }
    public void setGithubToken(String githubToken) { this.githubToken = githubToken; }
    public String getAccountType() { return accountType; }
    public void setAccountType(String accountType) { this.accountType = accountType; }
    public String getApiUrl() { return apiUrl; }
    public void setApiUrl(String apiUrl) { this.apiUrl = apiUrl; }
    public String getOwnerId() { return ownerId; }
    public void setOwnerId(String ownerId) { this.ownerId = ownerId; }
    public String getCreatedAt() { return createdAt; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }
}
