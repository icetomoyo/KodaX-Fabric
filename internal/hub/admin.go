package hub

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"kodax-fabric/internal/store"
)

func (s *Server) adminAuthorized(r *http.Request) bool {
	if s == nil || s.AdminToken == "" {
		return false
	}
	got := r.Header.Get("X-Admin-Token")
	if got == "" {
		got = extractCallerKey(r)
	}
	return tokenEq(got, s.AdminToken)
}

func tokenEq(a, b string) bool {
	ha := sha256.Sum256([]byte(a))
	hb := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(ha[:], hb[:]) == 1
}

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if s.adminAuthorized(r) {
		return true
	}
	writeJSON(w, http.StatusUnauthorized, map[string]any{
		"error": map[string]any{"message": "admin unauthorized", "code": "admin_unauthorized"},
	})
	return false
}

func (s *Server) handleCreateVKApp(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var in store.VKApplication
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil && !errors.Is(err, io.EOF) {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	app, err := s.Store.CreateVKApplication(r.Context(), in)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, app)
}

func (s *Server) handleListVKApps(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	apps, err := s.Store.ListVKApplications(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if apps == nil {
		apps = []store.VKApplication{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"applications": apps})
}

func (s *Server) handleGetVKApp(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	app, err := s.Store.GetVKApplication(r.Context(), id)
	if err != nil || app == nil {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, app)
}

func (s *Server) handleApproveVKApp(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	app, raw, err := s.Store.ApproveVKApplication(r.Context(), id, s.now())
	if err == store.ErrAlreadyDecided {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":      map[string]any{"message": "already decided", "code": "already_decided"},
			"status":     app.Status,
			"key_masked": app.KeyMasked,
		})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if app == nil {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"application": app,
		"virtual_key": raw,
	})
}

func (s *Server) handleRejectVKApp(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var in struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	app, err := s.Store.RejectVKApplication(r.Context(), id, in.Reason)
	if err == store.ErrAlreadyDecided {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":  map[string]any{"message": "already decided", "code": "already_decided"},
			"status": app.Status,
		})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if app == nil {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, app)
}

func (s *Server) handleListProviderKeys(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	keys, err := s.Store.ListProviderKeys(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": keys})
}

func (s *Server) handleRotateProviderKey(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var in struct {
		Secret     string     `json:"secret"`
		ActivateAt *time.Time `json:"activate_at"`
		RetireAt   *time.Time `json:"retire_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(in.Secret) == "" {
		http.Error(w, "secret required", http.StatusBadRequest)
		return
	}
	if err := s.Store.StageProviderRotation(r.Context(), id, in.Secret, in.ActivateAt, in.RetireAt, s.now()); err != nil {
		writeRotationErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}

func (s *Server) handleActivateProviderKey(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := s.Store.ActivateProviderRotation(r.Context(), id, s.now()); err != nil {
		writeRotationErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}

func writeRotationErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrKeyNotFound), errors.Is(err, store.ErrNoReplacement):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"message": err.Error(), "code": "not_found"}})
	case errors.Is(err, store.ErrRotationConflict):
		writeJSON(w, http.StatusConflict, map[string]any{"error": map[string]any{"message": err.Error(), "code": "rotation_conflict"}})
	case errors.Is(err, store.ErrInvalidRotationSchedule):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": err.Error(), "code": "invalid_schedule"}})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "rotation failed", "code": "rotation_error"}})
	}
}
