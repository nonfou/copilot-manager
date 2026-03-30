package handler

import (
	"encoding/json"
	"net/http"

	"copilot-manager/internal/crypto"
	"copilot-manager/internal/idgen"
	"copilot-manager/internal/middleware"
	"copilot-manager/internal/store"

	"github.com/go-chi/chi/v5"
)

// sanitizeUser strips sensitive fields from a user.
func sanitizeUser(u *store.User) M {
	return M{
		"id":            u.ID,
		"username":      u.Username,
		"role":          u.Role,
		"created_at":    u.CreatedAt,
		"created_by":    u.CreatedBy,
		"last_login_at": u.LastLoginAt,
	}
}

// ─── GET /api/users ────────────────────────────────────────────────────────

func handleListUsers(w http.ResponseWriter, r *http.Request) {
	users := store.GetUsers()
	currentUser := store.GetUserByID(middleware.GetUserID(r))
	result := make([]M, len(users))
	for i := range users {
		result[i] = sanitizeUser(&users[i])
	}

	response := M{
		"users": result,
		"total": len(users),
	}
	if currentUser != nil {
		response["current_user"] = sanitizeUser(currentUser)
	} else {
		response["current_user"] = nil
	}
	writeJSON(w, http.StatusOK, response)
}

// ─── POST /api/users ───────────────────────────────────────────────────────

func handleCreateUser(w http.ResponseWriter, r *http.Request) {
	currentUserID := middleware.GetUserID(r)

	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if body.Username == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "Username and password required")
		return
	}
	if len(body.Username) < 3 || len(body.Username) > 32 {
		writeError(w, http.StatusBadRequest, "Username must be 3-32 characters")
		return
	}
	if len(body.Password) < 6 {
		writeError(w, http.StatusBadRequest, "Password must be at least 6 characters")
		return
	}

	role := store.RoleUser
	if body.Role == string(store.RoleAdmin) {
		role = store.RoleAdmin
	}

	if store.GetUserByUsername(body.Username) != nil {
		writeError(w, http.StatusConflict, "Username already exists")
		return
	}

	hash, err := crypto.HashPassword(body.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}

	now := nowISO()
	var createdBy *string
	if currentUserID != "" {
		createdBy = &currentUserID
	}

	newUser := store.User{
		ID:           idgen.GenerateID("usr"),
		Username:     body.Username,
		PasswordHash: hash,
		Role:         role,
		CreatedAt:    now,
		CreatedBy:    createdBy,
		LastLoginAt:  nil,
	}
	store.AddUser(newUser)
	writeJSON(w, http.StatusCreated, sanitizeUser(&newUser))
}

// ─── GET /api/users/:id ────────────────────────────────────────────────────

func handleGetUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user := store.GetUserByID(id)
	if user == nil {
		writeError(w, http.StatusNotFound, "User not found")
		return
	}
	writeJSON(w, http.StatusOK, sanitizeUser(user))
}

// ─── PUT /api/users/:id ────────────────────────────────────────────────────

func handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user := store.GetUserByID(id)
	if user == nil {
		writeError(w, http.StatusNotFound, "User not found")
		return
	}

	var body struct {
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Check username uniqueness
	if body.Username != "" && body.Username != user.Username {
		if store.GetUserByUsername(body.Username) != nil {
			writeError(w, http.StatusConflict, "Username already exists")
			return
		}
	}

	updates := M{}
	if body.Username != "" && len(body.Username) >= 3 && len(body.Username) <= 32 {
		updates["username"] = body.Username
	}
	if body.Role == string(store.RoleAdmin) || body.Role == string(store.RoleUser) {
		updates["role"] = body.Role
	}

	updated := store.UpdateUser(id, updates)
	if updated == nil {
		writeError(w, http.StatusInternalServerError, "Update failed")
		return
	}
	writeJSON(w, http.StatusOK, sanitizeUser(updated))
}

// ─── DELETE /api/users/:id ─────────────────────────────────────────────────

func handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	currentUserID := middleware.GetUserID(r)
	if id == currentUserID {
		writeError(w, http.StatusBadRequest, "Cannot delete yourself")
		return
	}
	user := store.GetUserByID(id)
	if user == nil {
		writeError(w, http.StatusNotFound, "User not found")
		return
	}
	_ = store.DeleteUser(id)
	writeJSON(w, http.StatusOK, M{})
}

// ─── POST /api/users/:id/reset-password ────────────────────────────────────

func handleResetPassword(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user := store.GetUserByID(id)
	if user == nil {
		writeError(w, http.StatusNotFound, "User not found")
		return
	}

	var body struct {
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if len(body.NewPassword) < 6 {
		writeError(w, http.StatusBadRequest, "New password must be at least 6 characters")
		return
	}

	hash, err := crypto.HashPassword(body.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}
	store.UpdateUser(id, M{"password_hash": hash})
	writeJSON(w, http.StatusOK, M{})
}
