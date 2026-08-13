package hub

import (
	"net/http"

	"kodax-fabric/internal/store"
)

func (s *Server) handleListProviderKeys(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	rows, err := s.Console.ListProviderKeys(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"provider_keys": rows})
}

func (s *Server) handleCreateProviderKey(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	var body struct {
		ProviderCode string `json:"provider_code"`
		Secret       string `json:"secret"`
		TeamID       int64  `json:"team_id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.CreateProviderKey(r.Context(), store.ProviderKeyCreate{
		ProviderCode: body.ProviderCode, Secret: body.Secret, TeamID: body.TeamID,
	})
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handlePatchProviderKey(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	id, err := pathID(r)
	if err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "bad id")
		return
	}
	var body store.ProviderKeyUpdate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.UpdateProviderKey(r.Context(), id, body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) handleListPools(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	rows, err := s.Console.ListPools(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pools": rows})
}

func (s *Server) handleCreatePool(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	var body store.PoolCreate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.CreatePool(r.Context(), body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handlePatchPool(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	id, err := pathID(r)
	if err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "bad id")
		return
	}
	var body store.PoolUpdate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.UpdatePool(r.Context(), id, body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) handleListChannels(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	rows, err := s.Console.ListChannels(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"channels": rows})
}

func (s *Server) handleCreateChannel(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	var body store.ChannelCreate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.CreateChannel(r.Context(), body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handlePatchChannel(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	id, err := pathID(r)
	if err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "bad id")
		return
	}
	var body store.ChannelUpdate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.UpdateChannel(r.Context(), id, body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) handleListVKs(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	rows, err := s.Console.ListVirtualKeys(r.Context(), 0)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"virtual_keys": rows})
}

func (s *Server) handleCreateVK(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	var body store.VirtualKeyCreate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.CreateVirtualKey(r.Context(), body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handlePatchVK(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	id, err := pathID(r)
	if err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "bad id")
		return
	}
	var body store.VirtualKeyUpdate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.UpdateVirtualKey(r.Context(), id, body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}
