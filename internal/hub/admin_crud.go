package hub

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"kodax-fabric/internal/store"
)

func writeAdminErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound), errors.Is(err, store.ErrKeyNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"message": "not found", "code": "not_found"}})
	case errors.Is(err, store.ErrConflict), errors.Is(err, store.ErrAlreadyDecided), errors.Is(err, store.ErrRotationConflict):
		writeJSON(w, http.StatusConflict, map[string]any{"error": map[string]any{"message": err.Error(), "code": "conflict"}})
	case errors.Is(err, store.ErrBadRequest), errors.Is(err, store.ErrInvalidRotationSchedule):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": err.Error(), "code": "bad_request"}})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "internal error", "code": "internal"}})
	}
}

func (s *Server) handleListProviders(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	out, err := s.Store.ListProviders(r.Context())
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": out})
}

func (s *Server) handleCreateProvider(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var in store.ProviderWrite
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAdminErr(w, store.ErrBadRequest)
		return
	}
	out, err := s.Store.CreateProvider(r.Context(), in)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handleUpdateProvider(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var in store.ProviderPatch
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAdminErr(w, store.ErrBadRequest)
		return
	}
	out, err := s.Store.UpdateProvider(r.Context(), id, in)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDisableProvider(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := s.Store.DisableProvider(r.Context(), id); err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListPools(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	out, err := s.Store.ListPools(r.Context())
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pools": out})
}

func (s *Server) handleCreatePool(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var in store.ChannelPool
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAdminErr(w, store.ErrBadRequest)
		return
	}
	out, err := s.Store.CreatePool(r.Context(), in)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handleUpdatePool(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var in store.PoolPatch
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAdminErr(w, store.ErrBadRequest)
		return
	}
	out, err := s.Store.UpdatePool(r.Context(), id, in)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleListChannels(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	out, err := s.Store.ListChannelsAdmin(r.Context())
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"channels": out})
}

func (s *Server) handleCreateChannel(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var in store.ChannelAdmin
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAdminErr(w, store.ErrBadRequest)
		return
	}
	out, err := s.Store.CreateChannel(r.Context(), in)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handleUpdateChannel(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var in store.ChannelPatch
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAdminErr(w, store.ErrBadRequest)
		return
	}
	out, err := s.Store.UpdateChannel(r.Context(), id, in)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDisableChannel(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := s.Store.DisableChannel(r.Context(), id); err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListVKs(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	out, err := s.Store.ListVirtualKeys(r.Context())
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"virtual_keys": out})
}

func (s *Server) handleCreateVK(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var in store.VirtualKeyAdmin
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAdminErr(w, store.ErrBadRequest)
		return
	}
	out, raw, err := s.Store.CreateVirtualKey(r.Context(), in)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"virtual_key": out, "plaintext": raw})
}

func (s *Server) handleUpdateVK(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var in store.VirtualKeyPatch
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAdminErr(w, store.ErrBadRequest)
		return
	}
	out, err := s.Store.UpdateVirtualKey(r.Context(), id, in)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDisableVK(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := s.Store.DisableVirtualKey(r.Context(), id); err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
