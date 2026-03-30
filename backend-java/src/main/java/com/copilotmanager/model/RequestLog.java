package com.copilotmanager.model;

import jakarta.persistence.*;

@Entity
@Table(name = "request_logs")
public class RequestLog {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "api_key_id", nullable = false)
    private String apiKeyId;

    @Column(name = "account_id", nullable = false)
    private String accountId;

    @Column(name = "api_key_name", nullable = false)
    private String apiKeyName;

    @Column(name = "account_name", nullable = false)
    private String accountName;

    @Column(name = "method", nullable = false)
    private String method;

    @Column(name = "path", nullable = false)
    private String path;

    @Column(name = "status_code", nullable = false)
    private int statusCode;

    @Column(name = "duration_ms", nullable = false)
    private long durationMs;

    @Column(name = "model")
    private String model;

    @Column(name = "error")
    private String error;

    @Column(name = "prompt_tokens")
    private Long promptTokens;

    @Column(name = "completion_tokens")
    private Long completionTokens;

    @Column(name = "total_tokens")
    private Long totalTokens;

    @Column(name = "first_token_ms")
    private Long firstTokenMs;

    @Column(name = "created_at", nullable = false)
    private String createdAt;

    // Getters & Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getApiKeyId() { return apiKeyId; }
    public void setApiKeyId(String apiKeyId) { this.apiKeyId = apiKeyId; }
    public String getAccountId() { return accountId; }
    public void setAccountId(String accountId) { this.accountId = accountId; }
    public String getApiKeyName() { return apiKeyName; }
    public void setApiKeyName(String apiKeyName) { this.apiKeyName = apiKeyName; }
    public String getAccountName() { return accountName; }
    public void setAccountName(String accountName) { this.accountName = accountName; }
    public String getMethod() { return method; }
    public void setMethod(String method) { this.method = method; }
    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }
    public int getStatusCode() { return statusCode; }
    public void setStatusCode(int statusCode) { this.statusCode = statusCode; }
    public long getDurationMs() { return durationMs; }
    public void setDurationMs(long durationMs) { this.durationMs = durationMs; }
    public String getModel() { return model; }
    public void setModel(String model) { this.model = model; }
    public String getError() { return error; }
    public void setError(String error) { this.error = error; }
    public Long getPromptTokens() { return promptTokens; }
    public void setPromptTokens(Long promptTokens) { this.promptTokens = promptTokens; }
    public Long getCompletionTokens() { return completionTokens; }
    public void setCompletionTokens(Long completionTokens) { this.completionTokens = completionTokens; }
    public Long getTotalTokens() { return totalTokens; }
    public void setTotalTokens(Long totalTokens) { this.totalTokens = totalTokens; }
    public Long getFirstTokenMs() { return firstTokenMs; }
    public void setFirstTokenMs(Long firstTokenMs) { this.firstTokenMs = firstTokenMs; }
    public String getCreatedAt() { return createdAt; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }
}
