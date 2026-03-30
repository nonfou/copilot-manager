package com.copilotmanager.repository;

import com.copilotmanager.model.SystemConfig;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SystemConfigRepository extends JpaRepository<SystemConfig, Integer> {
}
