package hub

import (
	"net/http"
	"strconv"

	"kodax-fabric/internal/store"
)

func (s *Server) handleListTeams(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	rows, err := s.Console.ListTeams(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"teams": rows})
}

func (s *Server) handleCreateTeam(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	var body store.TeamCreate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.CreateTeam(r.Context(), body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	rows, err := s.Console.ListProjects(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": rows})
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	var body store.ProjectCreate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	row, err := s.Console.CreateProject(r.Context(), body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handleListRouteDecisions(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	limit := 50
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil {
			limit = n
		}
	}
	rows, err := s.Console.ListRouteDecisions(r.Context(), limit)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"route_decisions": rows})
}
