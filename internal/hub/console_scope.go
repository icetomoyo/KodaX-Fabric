package hub

import (
	"context"
	"net/http"

	"kodax-fabric/internal/store"
)

func (s *Server) forbidIfOutsideTeam(w http.ResponseWriter, op *store.Operator, teamID int64) bool {
	if store.IsOrgAdmin(op.Role) {
		return false
	}
	if op.Role == store.RoleTeamAdmin && op.TeamID > 0 && op.TeamID == teamID {
		return false
	}
	writeConsoleErr(w, http.StatusForbidden, "forbidden", "outside team")
	return true
}

func (s *Server) poolTeam(ctx context.Context, poolID int64) (int64, error) {
	rows, err := s.Console.ListPools(ctx)
	if err != nil {
		return 0, err
	}
	for _, p := range rows {
		if p.ID == poolID {
			return p.TeamID, nil
		}
	}
	return 0, store.ErrNotFound
}

func (s *Server) projectTeam(ctx context.Context, projectID int64) (int64, error) {
	rows, err := s.Console.ListProjects(ctx)
	if err != nil {
		return 0, err
	}
	for _, p := range rows {
		if p.ID == projectID {
			return p.TeamID, nil
		}
	}
	return 0, store.ErrNotFound
}

func (s *Server) channelTeam(ctx context.Context, channelID int64) int64 {
	rows, err := s.Console.ListChannels(ctx)
	if err != nil {
		return 0
	}
	for _, c := range rows {
		if c.ID == channelID {
			t, err := s.poolTeam(ctx, c.PoolID)
			if err != nil {
				return 0
			}
			return t
		}
	}
	return 0
}

func (s *Server) vkTeam(ctx context.Context, vk store.VirtualKeyView) int64 {
	if vk.ProjectID > 0 {
		if t, err := s.projectTeam(ctx, vk.ProjectID); err == nil {
			return t
		}
	}
	if vk.PoolID > 0 {
		if t, err := s.poolTeam(ctx, vk.PoolID); err == nil {
			return t
		}
	}
	return 0
}

func (s *Server) requireSameTeamIssue(w http.ResponseWriter, r *http.Request, op *store.Operator, in store.VirtualKeyCreate) bool {
	if in.PoolID == 0 || in.ProjectID == 0 {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "project and pool required")
		return false
	}
	poolTeam, err := s.poolTeam(r.Context(), in.PoolID)
	if err != nil {
		writeStoreErr(w, err)
		return false
	}
	projTeam, err := s.projectTeam(r.Context(), in.ProjectID)
	if err != nil {
		writeStoreErr(w, err)
		return false
	}
	if poolTeam != projTeam {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "project and pool must share a team")
		return false
	}
	if op.Role == store.RoleTeamAdmin || op.Role == store.RoleDeveloper {
		if op.TeamID != poolTeam {
			writeConsoleErr(w, http.StatusBadRequest, "invalid", "outside team")
			return false
		}
	}
	if in.OwnerID > 0 {
		owner, err := s.Console.GetOperator(r.Context(), in.OwnerID)
		if err != nil {
			writeStoreErr(w, err)
			return false
		}
		if owner.TeamID > 0 && owner.TeamID != poolTeam {
			writeConsoleErr(w, http.StatusBadRequest, "invalid", "owner team mismatch")
			return false
		}
	}
	return true
}

func visibleTeam(op *store.Operator) (teamID int64, scoped bool) {
	if op.Role == store.RoleTeamAdmin && op.TeamID > 0 {
		return op.TeamID, true
	}
	return 0, false
}
