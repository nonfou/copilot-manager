package com.copilotmanager.controller;

import com.copilotmanager.service.AccountService;
import com.copilotmanager.service.StatsService;
import org.springframework.boot.info.BuildProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.management.ManagementFactory;
import java.util.Map;

@RestController
public class HealthController {

    private final AccountService accountService;
    private final StatsService statsService;
    private static final long START_TIME = System.currentTimeMillis();

    public HealthController(AccountService accountService, StatsService statsService) {
        this.accountService = accountService;
        this.statsService = statsService;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        long uptime = (System.currentTimeMillis() - START_TIME) / 1000;
        return Map.of(
                "status", "ok",
                "uptime", uptime,
                "accounts", Map.of("total", accountService.countAll())
        );
    }
}
