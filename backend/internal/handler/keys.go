package handler

import (
	"encoding/json"
	"net/http"

	"copilot-manager/internal/idgen"
	"copilot-manager/internal/middleware"
	"copilot-manager/internal/store"

	"github.com/go-chi/chi/v5"
)

// maskKey returns a masked version of the key value.
func maskKey(key string) string {
	if len(key) > 20 {
		return key[:16] + "..." + key[len(key)-4:]
	}
	return "****"
}

// keyToMap converts an ApiKey to a map for JSON output, with masked key.
func keyToMap(k store.ApiKey, masked bool) M {
	keyVal := k.Key
	maskedVal := maskKey(k.Key)
	if masked {
		keyVal = maskedVal
	}
	return M{
		"id":            k.ID,
		"key":           keyVal,
		"masked_key":    maskedVal,
		"name":          k.Name,
		"account_id":    k.AccountID,
		"owner_id":      k.OwnerID,
		"enabled":       k.Enabled,
		"request_count": k.RequestCount,
		"last_used_at":  k.LastUsedAt,
		"created_at":    k.CreatedAt,
	}
}

// ─── GET /api/keys ─────────────────────────────────────────────────────────

func handleListKeys(w http.ResponseWriter, r *http.Request) {
	accountID := r.URL.Query().Get("account_id")
	userID := middleware.GetUserID(r)
	admin := middleware.IsAdmin(r)

	ownerFilter := userID
	if admin {
		ownerFilter = ""
	}
	keys := store.GetKeys(ownerFilter, accountID)

	result := make([]M, len(keys))
	for i, k := range keys {
		m := keyToMap(k, true)
		if admin {
			owner := store.GetUserByID(k.OwnerID)
			ownerUsername := k.OwnerID
			if owner != nil {
				ownerUsername = owner.Username
			}
			m["owner_username"] = ownerUsername
		}
		result[i] = m
	}
	writeJSON(w, http.StatusOK, result)
}

// ─── POST /api/keys ────────────────────────────────────────────────────────

func handleCreateKey(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	admin := middleware.IsAdmin(r)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	var body struct {
		Name      string  `json:"name"`
		AccountID string  `json:"account_id"`
		OwnerID   *string `json:"owner_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.Name == "" || body.AccountID == "" {
		writeError(w, http.StatusBadRequest, "name and account_id are required")
		return
	}

	ownerFilter := userID
	if admin {
		ownerFilter = ""
	}
	account := store.GetAccountByID(body.AccountID, ownerFilter)
	if account == nil {
		writeError(w, http.StatusNotFound, "Account not found or no permission")
		return
	}

	targetOwnerID := account.OwnerID
	if admin && body.OwnerID != nil && *body.OwnerID != "" {
		targetUser := store.GetUserByID(*body.OwnerID)
		if targetUser == nil {
			writeError(w, http.StatusNotFound, "Target user not found")
			return
		}
		targetOwnerID = *body.OwnerID
	}

	rawKey := idgen.GenerateAPIKey()
	newKey := store.ApiKey{
		ID:           idgen.GenerateID("key"),
		Key:          rawKey,
		Name:         body.Name,
		AccountID:    body.AccountID,
		OwnerID:      targetOwnerID,
		Enabled:      true,
		RequestCount: 0,
		LastUsedAt:   nil,
		CreatedAt:    nowISO(),
	}
	store.AddKey(newKey)

	// Return full key on creation (one-time)
	writeJSON(w, http.StatusCreated, keyToMap(newKey, false))
}

// ─── GET /api/keys/:id ────────────────────────────────────────────────────

func handleGetKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := middleware.GetUserID(r)
	admin := middleware.IsAdmin(r)

	ownerFilter := userID
	if admin {
		ownerFilter = ""
	}
	key := store.GetKeyByID(id, ownerFilter)
	if key == nil {
		writeError(w, http.StatusNotFound, "Key not found or no permission")
		return
	}

	m := keyToMap(*key, true)
	account := store.GetAccountByID(key.AccountID, "")
	if account != nil {
		m["account"] = M{
			"id":           account.ID,
			"name":         account.Name,
			"account_type": account.AccountType,
			"api_url":      account.APIURL,
		}
	} else {
		m["account"] = nil
	}
	if admin {
		owner := store.GetUserByID(key.OwnerID)
		ownerUsername := key.OwnerID
		if owner != nil {
			ownerUsername = owner.Username
		}
		m["owner_username"] = ownerUsername
	}
	writeJSON(w, http.StatusOK, m)
}

// ─── PUT /api/keys/:id ────────────────────────────────────────────────────

func handleUpdateKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := middleware.GetUserID(r)
	admin := middleware.IsAdmin(r)

	var body struct {
		Name    *string `json:"name"`
		Enabled *bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	updates := M{}
	if body.Name != nil && *body.Name != "" {
		updates["name"] = *body.Name
	}
	if body.Enabled != nil {
		updates["enabled"] = *body.Enabled
	}

	ownerFilter := userID
	if admin {
		ownerFilter = ""
	}
	updated := store.UpdateKey(id, ownerFilter, updates)
	if updated == nil {
		writeError(w, http.StatusNotFound, "Key not found or no permission")
		return
	}
	writeJSON(w, http.StatusOK, keyToMap(*updated, true))
}

// ─── DELETE /api/keys/:id ─────────────────────────────────────────────────

func handleDeleteKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := middleware.GetUserID(r)
	admin := middleware.IsAdmin(r)

	ownerFilter := userID
	if admin {
		ownerFilter = ""
	}
	if !store.DeleteKey(id, ownerFilter) {
		writeError(w, http.StatusNotFound, "Key not found or no permission")
		return
	}
	writeJSON(w, http.StatusOK, M{"success": true})
}

// ─── POST /api/keys/:id/regenerate ────────────────────────────────────────

func handleRegenerateKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := middleware.GetUserID(r)
	admin := middleware.IsAdmin(r)

	newKeyVal := idgen.GenerateAPIKey()
	ownerFilter := userID
	if admin {
		ownerFilter = ""
	}
	updated := store.UpdateKey(id, ownerFilter, M{"key": newKeyVal})
	if updated == nil {
		writeError(w, http.StatusNotFound, "Key not found or no permission")
		return
	}
	// Return full new key
	writeJSON(w, http.StatusOK, keyToMap(*updated, false))
}
