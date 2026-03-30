package com.copilotmanager.service;

import com.copilotmanager.idgen.IdGen;
import com.copilotmanager.model.ApiKey;
import com.copilotmanager.repository.ApiKeyRepository;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class LogService {

    private static final long MAX_LOGS = 5000L;

    private final AtomicLong logCount = new AtomicLong(0);
    private final com.copilotmanager.repository.RequestLogRepository requestLogRepository;
    private final ApiKeyRepository apiKeyRepository;

    public LogService(com.copilotmanager.repository.RequestLogRepository requestLogRepository,
                      ApiKeyRepository apiKeyRepository) {
        this.requestLogRepository = requestLogRepository;
        this.apiKeyRepository = apiKeyRepository;
    }

    @PostConstruct
    public void initCount() {
        logCount.set(requestLogRepository.count());
    }

    public void appendLog(com.copilotmanager.model.RequestLog log) {
        requestLogRepository.save(log);
        long count = logCount.incrementAndGet();
        if (count % 50 == 0) {
            requestLogRepository.deleteOldLogs(MAX_LOGS);
        }
    }

    public void incrementKeyRequestCount(String keyId) {
        apiKeyRepository.incrementRequestCount(keyId, Instant.now().toString());
    }
}
