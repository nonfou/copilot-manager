package com.copilotmanager.controller;

import com.copilotmanager.model.RequestLog;
import com.copilotmanager.repository.RequestLogRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/logs")
public class LogController {

    private final RequestLogRepository requestLogRepository;

    public LogController(RequestLogRepository requestLogRepository) {
        this.requestLogRepository = requestLogRepository;
    }

    @GetMapping
    public ResponseEntity<?> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(required = false) String account_id,
            @RequestParam(required = false) String api_key_id,
            HttpServletRequest request) {

        if (page < 1) page = 1;
        if (limit < 1 || limit > 200) limit = 50;

        Pageable pageable = PageRequest.of(page - 1, limit);
        Page<RequestLog> result;

        if (account_id != null && !account_id.isBlank() && api_key_id != null && !api_key_id.isBlank()) {
            result = requestLogRepository.findByAccountIdAndApiKeyIdOrderByCreatedAtDesc(account_id, api_key_id, pageable);
        } else if (account_id != null && !account_id.isBlank()) {
            result = requestLogRepository.findByAccountIdOrderByCreatedAtDesc(account_id, pageable);
        } else if (api_key_id != null && !api_key_id.isBlank()) {
            result = requestLogRepository.findByApiKeyIdOrderByCreatedAtDesc(api_key_id, pageable);
        } else {
            result = requestLogRepository.findAllByOrderByCreatedAtDesc(pageable);
        }

        return ResponseEntity.ok(Map.of(
                "logs", result.getContent(),
                "total", result.getTotalElements(),
                "page", page,
                "limit", limit
        ));
    }
}
