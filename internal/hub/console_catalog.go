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
		RPMLimit     int    `json:"rpm_limit"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.CreateProviderKey(r.Context(), store.ProviderKeyCreate{
		ProviderCode: body.ProviderCode, Secret: body.Secret, TeamID: body.TeamID, RPMLimit: body.RPMLimit,
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

func (s *Server) handleListPools(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	rows, err := s.Console.ListPools(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if teamID, scoped := visibleTeam(op); scoped {
		filtered := rows[:0]
		for _, p := range rows {
			if p.TeamID == teamID {
				filtered = append(filtered, p)
			}
		}
		rows = filtered
	} else if op.Role == store.RoleDeveloper && op.TeamID > 0 {
		filtered := rows[:0]
		for _, p := range rows {
			if p.TeamID == op.TeamID {
				filtered = append(filtered, p)
			}
		}
		rows = filtered
	}
	writeJSON(w, http.StatusOK, map[string]any{"pools": rows})
}

func (s *Server) handleCreatePool(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	var body store.PoolCreate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	if op.Role == store.RoleTeamAdmin {
		if body.TeamID == 0 {
			body.TeamID = op.TeamID
		}
		if s.forbidIfOutsideTeam(w, op, body.TeamID) {
			return
		}
	}
	row, err := s.Console.CreatePool(r.Context(), body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handlePatchPool(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	id, err := pathID(r)
	if err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "bad id")
		return
	}
	teamID, err := s.poolTeam(r.Context(), id)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if s.forbidIfOutsideTeam(w, op, teamID) {
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

func (s *Server) handleListVKs(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	owner := int64(0)
	if op.Role == store.RoleDeveloper {
		owner = op.ID
	}
	rows, err := s.Console.ListVirtualKeys(r.Context(), owner)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if teamID, scoped := visibleTeam(op); scoped {
		filtered := rows[:0]
		for _, vk := range rows {
			if s.vkTeam(r.Context(), vk) == teamID {
				filtered = append(filtered, vk)
			}
		}
		rows = filtered
	}
	writeJSON(w, http.StatusOK, map[string]any{"virtual_keys": rows})
}

func (s *Server) handleCreateVK(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	var body store.VirtualKeyCreate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	if !s.requireSameTeamIssue(w, r, op, body) {
		return
	}
	row, err := s.Console.CreateVirtualKey(r.Context(), body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handlePatchVK(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	id, err := pathID(r)
	if err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "bad id")
		return
	}
	keys, err := s.Console.ListVirtualKeys(r.Context(), 0)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	var found *store.VirtualKeyView
	for i := range keys {
		if keys[i].ID == id {
			found = &keys[i]
			break
		}
	}
	if found == nil {
		writeStoreErr(w, store.ErrNotFound)
		return
	}
	if s.forbidIfOutsideTeam(w, op, s.vkTeam(r.Context(), *found)) {
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

func (s *Server) handleApplyVK(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	var body store.VirtualKeyCreate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	body.OwnerID = op.ID
	if !s.requireSameTeamIssue(w, r, op, body) {
		return
	}
	row, err := s.Console.ApplyVirtualKey(r.Context(), body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handleApproveVK(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	id, err := pathID(r)
	if err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "bad id")
		return
	}
	keys, err := s.Console.ListVirtualKeys(r.Context(), 0)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	var found *store.VirtualKeyView
	for i := range keys {
		if keys[i].ID == id {
			found = &keys[i]
			break
		}
	}
	if found == nil {
		writeStoreErr(w, store.ErrNotFound)
		return
	}
	if s.forbidIfOutsideTeam(w, op, s.vkTeam(r.Context(), *found)) {
		return
	}
	row, err := s.Console.ApproveVirtualKey(r.Context(), id)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) handleListAliases(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	rows, err := s.Console.ListModelAliases(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"model_aliases": rows})
}

func (s *Server) handlePutAlias(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	var body store.ModelAlias
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.PutModelAlias(r.Context(), body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}
