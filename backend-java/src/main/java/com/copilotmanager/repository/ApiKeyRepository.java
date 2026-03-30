package com.copilotmanager.repository;

import com.copilotmanager.model.ApiKey;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface ApiKeyRepository extends JpaRepository<ApiKey, String> {
    List<ApiKey> findByOwnerId(String ownerId);
    List<ApiKey> findByAccountId(String accountId);
    List<ApiKey> findByOwnerIdAndAccountId(String ownerId, String accountId);
    List<ApiKey> findByEnabledTrue();

    @Modifying
    @Transactional
    @Query("UPDATE ApiKey k SET k.requestCount = k.requestCount + 1, k.lastUsedAt = :now WHERE k.id = :id")
    void incrementRequestCount(@Param("id") String id, @Param("now") String now);

    long countByEnabledTrue();
}
