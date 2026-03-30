package com.copilotmanager.service;

import com.copilotmanager.repository.ApiKeyRepository;
import com.copilotmanager.repository.RequestLogRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;

@Service
public class StatsService {

    private final AccountService accountService;
    private final ApiKeyRepository apiKeyRepository;
    private final RequestLogRepository requestLogRepository;

    public StatsService(AccountService accountService,
                        ApiKeyRepository apiKeyRepository,
                        RequestLogRepository requestLogRepository) {
        this.accountService = accountService;
        this.apiKeyRepository = apiKeyRepository;
        this.requestLogRepository = requestLogRepository;
    }

    public Map<String, Object> getStats() {
        long totalAccounts = accountService.countAll();
        long enabledKeys = apiKeyRepository.countByEnabledTrue();
        long totalRequests = requestLogRepository.count();

        // Today's requests (UTC)
        String todayStart = ZonedDateTime.now(ZoneOffset.UTC)
                .toLocalDate()
                .atStartOfDay(ZoneOffset.UTC)
                .format(DateTimeFormatter.ISO_INSTANT);
        long todayRequests = requestLogRepository.countSince(todayStart);

        return Map.of(
                "total_accounts", totalAccounts,
                "enabled_keys", enabledKeys,
                "today_requests", todayRequests,
                "total_requests", totalRequests
        );
    }
}
