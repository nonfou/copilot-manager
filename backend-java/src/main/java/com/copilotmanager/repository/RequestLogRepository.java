package com.copilotmanager.repository;

import com.copilotmanager.model.RequestLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface RequestLogRepository extends JpaRepository<RequestLog, String> {

    Page<RequestLog> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<RequestLog> findByAccountIdOrderByCreatedAtDesc(String accountId, Pageable pageable);

    Page<RequestLog> findByApiKeyIdOrderByCreatedAtDesc(String apiKeyId, Pageable pageable);

    Page<RequestLog> findByAccountIdAndApiKeyIdOrderByCreatedAtDesc(
            String accountId, String apiKeyId, Pageable pageable);

    @Query(value = "SELECT COUNT(*) FROM request_logs WHERE created_at >= :since", nativeQuery = true)
    long countSince(@Param("since") String since);

    @Modifying
    @Transactional
    @Query(value = "DELETE FROM request_logs WHERE id NOT IN " +
            "(SELECT id FROM request_logs ORDER BY created_at DESC LIMIT :keep)",
            nativeQuery = true)
    void deleteOldLogs(@Param("keep") long keep);
}
