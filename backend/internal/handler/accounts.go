package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"copilot-manager/internal/idgen"
	"copilot-manager/internal/middleware"
	"copilot-manager/internal/ssrf"
	"copilot-manager/internal/store"

	"github.com/go-chi/chi/v5"
)

const (
	usageCacheTTL = 5 * time.Minute
	githubClientID = "Iv1.b507a08c87ecfe98" // GitHub Copilot official client_id
)

// ─── Usage/Models Cache ────────────────────────────────────────────────────

type cacheEntry struct {
	data      interface{}
	fetchedAt time.Time
}

var (
	usageCacheMu sync.RWMutex
	usageCacheMap = make(map[string]cacheEntry)

	modelsCacheMu  sync.RWMutex
	modelsCacheMap = make(map[string]cacheEntry)
)

func getUsageCache(id string) (interface{}, bool) {
	usageCacheMu.RLock()
	defer usageCacheMu.RUnlock()
	e, ok := usageCacheMap[id]
	if !ok || time.Since(e.fetchedAt) >= usageCacheTTL {
		return nil, false
	}
	return e.data, true
}

func setUsageCache(id string, data interface{}) {
	usageCacheMu.Lock()
	defer usageCacheMu.Unlock()
	usageCacheMap[id] = cacheEntry{data: data, fetchedAt: time.Now()}
}

func deleteUsageCache(id string) {
	usageCacheMu.Lock()
	defer usageCacheMu.Unlock()
	delete(usageCacheMap, id)
}

func getModelsCache(id string) (interface{}, bool) {
	modelsCacheMu.RLock()
	defer modelsCacheMu.RUnlock()
	e, ok := modelsCacheMap[id]
	if !ok || time.Since(e.fetchedAt) >= usageCacheTTL {
		return nil, false
	}
	return e.data, true
}

func getModelsCacheStale(id string) (interface{}, bool) {
	modelsCacheMu.RLock()
	defer modelsCacheMu.RUnlock()
	e, ok := modelsCacheMap[id]
	return e.data, ok
}

func setModelsCache(id string, data interface{}) {
	modelsCacheMu.Lock()
	defer modelsCacheMu.Unlock()
	modelsCacheMap[id] = cacheEntry{data: data, fetchedAt: time.Now()}
}

func deleteModelsCache(id string) {
	modelsCacheMu.Lock()
	defer modelsCacheMu.Unlock()
	delete(modelsCacheMap, id)
}

// ─── Token masking ────────────────────────────────────────────────────────

func maskToken(token string) string {
	if token == "" {
		return ""
	}
	if len(token) <= 8 {
		return "****"
	}
	return token[:4] + "****" + token[len(token)-4:]
}

// accountToMap converts an Account to a map, with masked github_token.
func accountToMap(a store.Account) M {
	return M{
		"id":           a.ID,
		"name":         a.Name,
		"github_token": maskToken(a.GithubToken),
		"account_type": a.AccountType,
		"api_url":      a.APIURL,
		"owner_id":     a.OwnerID,
		"created_at":   a.CreatedAt,
	}
}

// ─── GET /api/accounts ─────────────────────────────────────────────────────

func handleListAccounts(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	admin := middleware.IsAdmin(r)

	ownerFilter := userID
	if admin {
		ownerFilter = ""
	}
	accounts := store.GetAccounts(ownerFilter)
	result := make([]M, len(accounts))
	for i, a := range accounts {
		result[i] = accountToMap(a)
	}
	writeJSON(w, http.StatusOK, result)
}

// ─── POST /api/accounts ────────────────────────────────────────────────────

func handleCreateAccount(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	var body struct {
		Name        string `json:"name"`
		GithubToken string `json:"github_token"`
		AccountType string `json:"account_type"`
		APIURL      string `json:"api_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if body.APIURL == "" {
		writeError(w, http.StatusBadRequest, "api_url is required")
		return
	}

	if err := ssrf.ValidateAPIURL(body.APIURL); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	accountType := store.AccountIndividual
	switch body.AccountType {
	case "business":
		accountType = store.AccountBusiness
	case "enterprise":
		accountType = store.AccountEnterprise
	}

	account := store.Account{
		ID:          idgen.GenerateID("acc"),
		Name:        body.Name,
		GithubToken: body.GithubToken,
		AccountType: accountType,
		APIURL:      strings.TrimRight(body.APIURL, "/"),
		OwnerID:     userID,
		CreatedAt:   nowISO(),
	}
	store.AddAccount(account)
	writeJSON(w, http.StatusCreated, accountToMap(account))
}

// ─── PUT /api/accounts/:id ─────────────────────────────────────────────────

func handleUpdateAccount(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := middleware.GetUserID(r)
	admin := middleware.IsAdmin(r)

	var body struct {
		Name        *string `json:"name"`
		GithubToken *string `json:"github_token"`
		AccountType *string `json:"account_type"`
		APIURL      *string `json:"api_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	updates := M{}
	if body.Name != nil && *body.Name != "" {
		updates["name"] = *body.Name
	}
	if body.GithubToken != nil && *body.GithubToken != "" {
		updates["github_token"] = *body.GithubToken
	}
	if body.AccountType != nil {
		updates["account_type"] = *body.AccountType
	}
	if body.APIURL != nil && *body.APIURL != "" {
		if err := ssrf.ValidateAPIURL(*body.APIURL); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		updates["api_url"] = strings.TrimRight(*body.APIURL, "/")
	}

	ownerFilter := userID
	if admin {
		ownerFilter = ""
	}
	updated := store.UpdateAccount(id, ownerFilter, updates)
	if updated == nil {
		writeError(w, http.StatusNotFound, "Account not found or no permission")
		return
	}

	deleteUsageCache(id)
	deleteModelsCache(id)

	writeJSON(w, http.StatusOK, accountToMap(*updated))
}

// ─── DELETE /api/accounts/:id ──────────────────────────────────────────────

func handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := middleware.GetUserID(r)
	admin := middleware.IsAdmin(r)

	ownerFilter := userID
	if admin {
		ownerFilter = ""
	}
	account := store.GetAccountByID(id, ownerFilter)
	if account == nil {
		writeError(w, http.StatusNotFound, "Account not found or no permission")
		return
	}

	// Delete associated keys
	keyOwnerFilter := userID
	if admin {
		keyOwnerFilter = ""
	}
	keys := store.GetKeys(keyOwnerFilter, id)
	for _, k := range keys {
		store.DeleteKey(k.ID, keyOwnerFilter)
	}

	if !store.DeleteAccount(id, ownerFilter) {
		writeError(w, http.StatusInternalServerError, "Delete failed")
		return
	}

	deleteUsageCache(id)
	deleteModelsCache(id)

	writeJSON(w, http.StatusOK, M{"success": true})
}

// ─── GET /api/accounts/:id/usage ──────────────────────────────────────────

func handleGetAccountUsage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	forceRefresh := r.URL.Query().Get("refresh") == "true"
	userID := middleware.GetUserID(r)
	admin := middleware.IsAdmin(r)

	account := store.GetAccountByID(id, "")
	if account == nil {
		writeError(w, http.StatusNotFound, "Account not found or no permission")
		return
	}
	// Non-admin: must own the account or have a key for it
	if !admin && account.OwnerID != userID {
		keys := store.GetKeys(userID, id)
		if len(keys) == 0 {
			writeError(w, http.StatusNotFound, "Account not found or no permission")
			return
		}
	}
	if account.APIURL == "" {
		writeError(w, http.StatusBadRequest, "Account has no api_url configured")
		return
	}

	if !forceRefresh {
		if cached, ok := getUsageCache(id); ok {
			writeJSON(w, http.StatusOK, cached)
			return
		}
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(account.APIURL + "/usage")
	if err != nil {
		log.Printf("WARN: Usage fetch failed for account %s: %v", id, err)
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Failed to fetch usage: %v", err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Upstream returned %d", resp.StatusCode))
		return
	}
	var data interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		writeError(w, http.StatusBadGateway, "Failed to decode upstream response")
		return
	}
	setUsageCache(id, data)
	writeJSON(w, http.StatusOK, data)
}

// ─── GET /api/accounts/:id/models ─────────────────────────────────────────

func handleGetAccountModels(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	forceRefresh := r.URL.Query().Get("refresh") == "true"
	userID := middleware.GetUserID(r)
	admin := middleware.IsAdmin(r)

	account := store.GetAccountByID(id, "")
	if account == nil {
		writeError(w, http.StatusNotFound, "Account not found or no permission")
		return
	}
	if !admin && account.OwnerID != userID {
		keys := store.GetKeys(userID, id)
		if len(keys) == 0 {
			writeError(w, http.StatusNotFound, "Account not found or no permission")
			return
		}
	}
	if account.APIURL == "" {
		writeError(w, http.StatusServiceUnavailable, "Account has no api_url configured")
		return
	}

	if !forceRefresh {
		if cached, ok := getModelsCache(id); ok {
			writeJSON(w, http.StatusOK, cached)
			return
		}
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(account.APIURL + "/v1/models")
	if err != nil {
		log.Printf("WARN: Models fetch failed for account %s: %v", id, err)
		if stale, ok := getModelsCacheStale(id); ok {
			writeJSON(w, http.StatusOK, stale)
			return
		}
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Failed to fetch models: %v", err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if stale, ok := getModelsCacheStale(id); ok {
			writeJSON(w, http.StatusOK, stale)
			return
		}
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Upstream returned %d", resp.StatusCode))
		return
	}
	var data interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		writeError(w, http.StatusBadGateway, "Failed to decode upstream response")
		return
	}
	setModelsCache(id, data)
	writeJSON(w, http.StatusOK, data)
}

// ─── POST /api/accounts/auth/start (Device Flow) ──────────────────────────

func handleAuthStart(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	var body struct {
		Name        string `json:"name"`
		AccountType string `json:"account_type"`
		APIURL      string `json:"api_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.Name == "" || body.APIURL == "" {
		writeError(w, http.StatusBadRequest, "name and api_url are required")
		return
	}
	if err := ssrf.ValidateAPIURL(body.APIURL); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Call GitHub Device Flow API
	reqBody, _ := json.Marshal(M{
		"client_id": githubClientID,
		"scope":     "read:user",
	})
	ghReq, _ := http.NewRequest("POST", "https://github.com/login/device/code", bytes.NewReader(reqBody))
	ghReq.Header.Set("Content-Type", "application/json")
	ghReq.Header.Set("Accept", "application/json")

	ghClient := &http.Client{Timeout: 10 * time.Second}
	ghResp, err := ghClient.Do(ghReq)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer ghResp.Body.Close()

	if ghResp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "Failed to start GitHub OAuth flow")
		return
	}

	var ghData struct {
		DeviceCode      string `json:"device_code"`
		UserCode        string `json:"user_code"`
		VerificationURI string `json:"verification_uri"`
		ExpiresIn       int    `json:"expires_in"`
		Interval        int    `json:"interval"`
	}
	if err := json.NewDecoder(ghResp.Body).Decode(&ghData); err != nil {
		writeError(w, http.StatusBadGateway, "Failed to decode GitHub response")
		return
	}

	accountType := store.AccountIndividual
	switch body.AccountType {
	case "business":
		accountType = store.AccountBusiness
	case "enterprise":
		accountType = store.AccountEnterprise
	}

	interval := ghData.Interval
	if interval <= 0 {
		interval = 5
	}
	expiresIn := ghData.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 900
	}

	authID := idgen.GenerateID("auth")
	session := store.AuthSession{
		AuthID:      authID,
		DeviceCode:  ghData.DeviceCode,
		Name:        body.Name,
		AccountType: accountType,
		APIURL:      strings.TrimRight(body.APIURL, "/"),
		OwnerID:     userID,
		Interval:    interval,
		StartedAt:   nowISO(),
		ExpiresAt:   time.Now().Add(time.Duration(expiresIn) * time.Second).UTC().Format(time.RFC3339),
	}
	store.SetAuthSession(session)

	writeJSON(w, http.StatusOK, M{
		"auth_id":          authID,
		"user_code":        ghData.UserCode,
		"verification_uri": ghData.VerificationURI,
		"expires_in":       expiresIn,
		"interval":         interval,
	})
}

// ─── GET /api/accounts/auth/poll/:auth_id (Device Flow poll) ──────────────

func handleAuthPoll(w http.ResponseWriter, r *http.Request) {
	authID := chi.URLParam(r, "auth_id")
	session := store.GetAuthSession(authID)
	if session == nil {
		writeJSON(w, http.StatusOK, M{"status": "expired"})
		return
	}

	// Check expiry
	expiry, err := time.Parse(time.RFC3339, session.ExpiresAt)
	if err != nil || time.Now().After(expiry) {
		store.DeleteAuthSession(authID)
		writeJSON(w, http.StatusOK, M{"status": "expired"})
		return
	}

	// Poll GitHub
	reqBody, _ := json.Marshal(M{
		"client_id":   githubClientID,
		"device_code": session.DeviceCode,
		"grant_type":  "urn:ietf:params:oauth:grant-type:device_code",
	})
	req, _ := http.NewRequest("POST", "https://github.com/login/oauth/access_token", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, M{"status": "error", "error": err.Error()})
		return
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	var data struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.Unmarshal(bodyBytes, &data); err != nil {
		writeJSON(w, http.StatusOK, M{"status": "error", "error": "Failed to decode GitHub response"})
		return
	}

	switch data.Error {
	case "authorization_pending", "slow_down":
		writeJSON(w, http.StatusOK, M{"status": "pending"})
		return
	case "expired_token":
		store.DeleteAuthSession(authID)
		writeJSON(w, http.StatusOK, M{"status": "expired"})
		return
	}

	if data.AccessToken != "" {
		account := store.Account{
			ID:          idgen.GenerateID("acc"),
			Name:        session.Name,
			GithubToken: data.AccessToken,
			AccountType: session.AccountType,
			APIURL:      session.APIURL,
			OwnerID:     session.OwnerID,
			CreatedAt:   nowISO(),
		}
		store.AddAccount(account)
		store.DeleteAuthSession(authID)
		writeJSON(w, http.StatusOK, M{
			"status":  "success",
			"account": accountToMap(account),
		})
		return
	}

	writeJSON(w, http.StatusOK, M{"status": "pending"})
}
