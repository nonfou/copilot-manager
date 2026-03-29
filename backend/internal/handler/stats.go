package handler

import (
	"net/http"
	"strconv"

	"copilot-manager/internal/store"
)

// ─── GET /api/stats ────────────────────────────────────────────────────────

func handleStats(w http.ResponseWriter, r *http.Request) {
	stats := store.GetStats()
	writeJSON(w, http.StatusOK, stats)
}

// ─── GET /api/logs ─────────────────────────────────────────────────────────

func handleLogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	accountID := q.Get("account_id")
	apiKeyID := q.Get("api_key_id")

	if page <= 0 {
		page = 1
	}
	if limit <= 0 {
		limit = 50
	}

	result := store.GetLogs(page, limit, accountID, apiKeyID)
	logs := result.Logs
	if logs == nil {
		logs = []store.RequestLog{}
	}
	writeJSON(w, http.StatusOK, M{
		"logs":  logs,
		"total": result.Total,
		"page":  page,
		"limit": limit,
	})
}
