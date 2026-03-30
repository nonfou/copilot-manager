package com.copilotmanager.model;

import jakarta.persistence.*;

@Entity
@Table(name = "system_config")
public class SystemConfig {

    @Id
    @Column(name = "id")
    private Integer id = 1;

    @Column(name = "initialized", nullable = false)
    private boolean initialized = false;

    @Column(name = "admin_created_at", nullable = false)
    private String adminCreatedAt = "";

    public Integer getId() { return id; }
    public void setId(Integer id) { this.id = id; }
    public boolean isInitialized() { return initialized; }
    public void setInitialized(boolean initialized) { this.initialized = initialized; }
    public String getAdminCreatedAt() { return adminCreatedAt; }
    public void setAdminCreatedAt(String adminCreatedAt) { this.adminCreatedAt = adminCreatedAt; }
}
