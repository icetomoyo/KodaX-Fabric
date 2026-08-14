package hub

import (
	"net/http"
	"strconv"

	"kodax-fabric/internal/store"
)

func (s *Server) handleListTeams(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	rows, err := s.Console.ListTeams(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if teamID, scoped := visibleTeam(op); scoped {
		filtered := rows[:0]
		for _, t := range rows {
			if t.ID == teamID {
				filtered = append(filtered, t)
			}
		}
		rows = filtered
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

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	rows, err := s.Console.ListProjects(r.Context())
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
	writeJSON(w, http.StatusOK, map[string]any{"projects": rows})
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	var body store.ProjectCreate
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
	row, err := s.Console.CreateProject(r.Context(), body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handleListRouteDecisions(w http.ResponseWriter, r *http.Request, op *store.Operator) {
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
	if teamID, scoped := visibleTeam(op); scoped {
		filtered := rows[:0]
		for _, d := range rows {
			if s.channelTeam(r.Context(), d.ChannelID) == teamID {
				filtered = append(filtered, d)
			}
		}
		rows = filtered
	} else if op.Role == store.RoleDeveloper {
		rows = rows[:0]
	}
	writeJSON(w, http.StatusOK, map[string]any{"route_decisions": rows})
}
