package hub

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"kodax-fabric/internal/store"
)

const sessionCookie = "th_session"
const sessionTTL = 24 * time.Hour

type session struct {
	OperatorID int64
	Expires    time.Time
}

type Sessions struct {
	mu sync.Mutex
	m  map[string]session
}

func NewSessions() *Sessions {
	return &Sessions{m: map[string]session{}}
}

func (s *Sessions) Issue(opID int64) string {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	tok := hex.EncodeToString(b[:])
	s.mu.Lock()
	s.m[tok] = session{OperatorID: opID, Expires: time.Now().Add(sessionTTL)}
	s.mu.Unlock()
	return tok
}

func (s *Sessions) Lookup(tok string) (int64, bool) {
	if s == nil || tok == "" {
		return 0, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ss, ok := s.m[tok]
	if !ok || time.Now().After(ss.Expires) {
		if ok {
			delete(s.m, tok)
		}
		return 0, false
	}
	return ss.OperatorID, true
}

func (s *Sessions) Revoke(tok string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	delete(s.m, tok)
	s.mu.Unlock()
}

func writeConsoleErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{"code": code, "message": msg},
	})
}

func writeStoreErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeConsoleErr(w, http.StatusNotFound, "not_found", "not found")
	case errors.Is(err, store.ErrConflict):
		writeConsoleErr(w, http.StatusConflict, "conflict", "already exists")
	case errors.Is(err, store.ErrForbidden):
		writeConsoleErr(w, http.StatusForbidden, "forbidden", "cannot remove the last admin")
	case errors.Is(err, store.ErrInvalid):
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid request")
	default:
		writeConsoleErr(w, http.StatusInternalServerError, "internal", "internal error")
	}
}

func (s *Server) mountConsole(mux *http.ServeMux) {
	if s.Console == nil {
		return
	}
	if s.Sessions == nil {
		s.Sessions = NewSessions()
	}
	mux.HandleFunc("POST /console/v1/login", s.handleLogin)
	mux.HandleFunc("POST /console/v1/logout", s.handleLogout)
	mux.HandleFunc("GET /console/v1/me", s.withAuth(accessAny, s.handleMe))
	mux.HandleFunc("PATCH /console/v1/me", s.withAuth(accessAny, s.handlePatchMe))
	mux.HandleFunc("GET /console/v1/me/keys", s.withAuth(accessAny, s.handleMyKeys))

	mux.HandleFunc("GET /console/v1/overview", s.withAuth(accessAny, s.handleOverview))
	mux.HandleFunc("GET /console/v1/teams", s.withAuth(accessAny, s.handleListTeams))
	mux.HandleFunc("POST /console/v1/teams", s.withAuth(accessOrg, s.handleCreateTeam))
	mux.HandleFunc("GET /console/v1/projects", s.withAuth(accessAny, s.handleListProjects))
	mux.HandleFunc("POST /console/v1/projects", s.withAuth(accessStaff, s.handleCreateProject))
	mux.HandleFunc("GET /console/v1/route-decisions", s.withAuth(accessAny, s.handleListRouteDecisions))
	mux.HandleFunc("GET /console/v1/users", s.withAuth(accessStaff, s.handleListUsers))
	mux.HandleFunc("POST /console/v1/users", s.withAuth(accessStaff, s.handleCreateUser))
	mux.HandleFunc("PATCH /console/v1/users/{id}", s.withAuth(accessStaff, s.handlePatchUser))

	mux.HandleFunc("GET /console/v1/provider-keys", s.withAuth(accessOrg, s.handleListProviderKeys))
	mux.HandleFunc("POST /console/v1/provider-keys", s.withAuth(accessOrg, s.handleCreateProviderKey))
	mux.HandleFunc("PATCH /console/v1/provider-keys/{id}", s.withAuth(accessOrg, s.handlePatchProviderKey))

	mux.HandleFunc("GET /console/v1/pools", s.withAuth(accessAny, s.handleListPools))
	mux.HandleFunc("POST /console/v1/pools", s.withAuth(accessStaff, s.handleCreatePool))
	mux.HandleFunc("PATCH /console/v1/pools/{id}", s.withAuth(accessStaff, s.handlePatchPool))

	mux.HandleFunc("GET /console/v1/channels", s.withAuth(accessOrg, s.handleListChannels))
	mux.HandleFunc("POST /console/v1/channels", s.withAuth(accessOrg, s.handleCreateChannel))
	mux.HandleFunc("PATCH /console/v1/channels/{id}", s.withAuth(accessOrg, s.handlePatchChannel))

	mux.HandleFunc("GET /console/v1/virtual-keys", s.withAuth(accessAny, s.handleListVKs))
	mux.HandleFunc("POST /console/v1/virtual-keys", s.withAuth(accessStaff, s.handleCreateVK))
	mux.HandleFunc("PATCH /console/v1/virtual-keys/{id}", s.withAuth(accessStaff, s.handlePatchVK))
	mux.HandleFunc("POST /console/v1/vk-requests", s.withAuth(accessAny, s.handleApplyVK))
	mux.HandleFunc("POST /console/v1/vk-requests/{id}/approve", s.withAuth(accessStaff, s.handleApproveVK))
	mux.HandleFunc("GET /console/v1/model-aliases", s.withAuth(accessOrg, s.handleListAliases))
	mux.HandleFunc("PUT /console/v1/model-aliases", s.withAuth(accessOrg, s.handlePutAlias))
}

type access int

const (
	accessAny access = iota
	accessStaff
	accessOrg
)

type authHandler func(http.ResponseWriter, *http.Request, *store.Operator)

func allowed(op *store.Operator, level access) bool {
	switch level {
	case accessAny:
		return true
	case accessStaff:
		return store.IsOrgAdmin(op.Role) || op.Role == store.RoleTeamAdmin
	case accessOrg:
		return store.IsOrgAdmin(op.Role)
	default:
		return false
	}
}

func (s *Server) withAuth(level access, fn authHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil || c.Value == "" {
			writeConsoleErr(w, http.StatusUnauthorized, "unauthorized", "not signed in")
			return
		}
		id, ok := s.Sessions.Lookup(c.Value)
		if !ok {
			writeConsoleErr(w, http.StatusUnauthorized, "unauthorized", "not signed in")
			return
		}
		op, err := s.Console.GetOperator(r.Context(), id)
		if err != nil || op == nil || op.Status != store.StatusActive {
			writeConsoleErr(w, http.StatusUnauthorized, "unauthorized", "not signed in")
			return
		}
		if !allowed(op, level) {
			writeConsoleErr(w, http.StatusForbidden, "forbidden", "admin only")
			return
		}
		fn(w, r, op)
	}
}

func setSessionCookie(w http.ResponseWriter, tok string, clear bool) {
	c := &http.Cookie{
		Name:     sessionCookie,
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(sessionTTL / time.Second),
	}
	if clear {
		c.Value = ""
		c.MaxAge = -1
	}
	http.SetCookie(w, c)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Phone    string `json:"phone"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	op, err := s.Console.AuthenticateOperator(r.Context(), body.Phone, body.Password)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if op == nil {
		writeConsoleErr(w, http.StatusUnauthorized, "invalid_credentials", "手机号或密码错误")
		return
	}
	tok := s.Sessions.Issue(op.ID)
	setSessionCookie(w, tok, false)
	writeJSON(w, http.StatusOK, map[string]any{"operator": op})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.Sessions.Revoke(c.Value)
	}
	setSessionCookie(w, "", true)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, _ *http.Request, op *store.Operator) {
	writeJSON(w, http.StatusOK, map[string]any{"operator": op})
}

func (s *Server) handlePatchMe(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	var body struct {
		Name     *string `json:"name"`
		Password *string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	updated, err := s.Console.UpdateOperator(r.Context(), op.ID, store.OperatorUpdate{
		Name:     body.Name,
		Password: body.Password,
	})
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"operator": updated})
}

func (s *Server) handleMyKeys(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	keys, err := s.Console.ListVirtualKeys(r.Context(), op.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"virtual_keys": keys})
}

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request, _ *store.Operator) {
	ov, err := s.Console.Overview(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ov)
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request, op *store.Operator) {
	users, err := s.Console.ListOperators(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if teamID, scoped := visibleTeam(op); scoped {
		filtered := users[:0]
		for _, u := range users {
			if u.TeamID == teamID {
				filtered = append(filtered, u)
			}
		}
		users = filtered
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request, actor *store.Operator) {
	var body struct {
		Phone    string `json:"phone"`
		Name     string `json:"name"`
		Role     string `json:"role"`
		Password string `json:"password"`
		TeamID   int64  `json:"team_id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	if actor.Role == store.RoleTeamAdmin {
		if store.CanonicalRole(body.Role) == store.RoleOrgAdmin {
			writeConsoleErr(w, http.StatusForbidden, "forbidden", "cannot create org admin")
			return
		}
		body.TeamID = actor.TeamID
	}
	op, err := s.Console.CreateOperator(r.Context(), store.OperatorCreate{
		Phone: body.Phone, Name: body.Name, Role: body.Role, Password: body.Password, TeamID: body.TeamID,
	})
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": op})
}

func (s *Server) handlePatchUser(w http.ResponseWriter, r *http.Request, actor *store.Operator) {
	id, err := pathID(r)
	if err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "bad id")
		return
	}
	cur, err := s.Console.GetOperator(r.Context(), id)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if s.forbidIfOutsideTeam(w, actor, cur.TeamID) {
		return
	}
	var body store.OperatorUpdate
	if err := decodeJSON(r, &body); err != nil {
		writeConsoleErr(w, http.StatusBadRequest, "invalid", "invalid json")
		return
	}
	op, err := s.Console.UpdateOperator(r.Context(), id, body)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": op})
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	return dec.Decode(v)
}

func pathID(r *http.Request) (int64, error) {
	return strconv.ParseInt(r.PathValue("id"), 10, 64)
}
