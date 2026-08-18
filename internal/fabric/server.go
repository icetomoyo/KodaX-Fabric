package fabric

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/icetomoyo/kodax-fabric/internal/webui"
	"golang.org/x/crypto/bcrypt"
)

type Server struct {
	Store       Store
	Provider    Provider
	Now         func() time.Time
	MasterKey   []byte
	UseRegistry bool

	mu       sync.Mutex
	sessions map[string]string
}

func NewServer(store Store, provider Provider) *Server {
	return &Server{
		Store:     store,
		Provider:  provider,
		Now:       func() time.Time { return time.Now().UTC() },
		MasterKey: TestMasterKey,
		sessions:  map[string]string{},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", s.handleChatCompletions)
	mux.HandleFunc("POST /v1/messages", s.handleMessages)
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /admin/api/login", s.handleLogin)
	mux.HandleFunc("POST /admin/api/logout", s.handleLogout)
	mux.HandleFunc("GET /admin/api/me", s.handleMe)
	mux.HandleFunc("POST /admin/api/enterprises", s.handleCreateEnterprise)
	mux.HandleFunc("GET /admin/api/enterprises", s.handleListEnterprises)
	mux.HandleFunc("POST /admin/api/enterprises/{name}/disable", s.handleDisableEnterprise)
	mux.HandleFunc("POST /admin/api/users", s.handleCreateUser)
	mux.HandleFunc("POST /admin/api/teams/{name}/members", s.handleAddMember)
	mux.HandleFunc("DELETE /admin/api/teams/{name}/members/{username}", s.handleRemoveMember)
	mux.HandleFunc("POST /admin/api/projects", s.handleCreateProject)
	mux.HandleFunc("GET /admin/api/projects", s.handleListProjects)
	mux.HandleFunc("POST /admin/api/virtual-keys", s.handleCreateVirtualKey)
	mux.HandleFunc("GET /admin/api/virtual-keys", s.handleListVirtualKeys)
	mux.HandleFunc("GET /admin/api/virtual-keys/{hash}", s.handleGetVirtualKey)
	mux.HandleFunc("POST /admin/api/virtual-keys/{hash}/disable", s.handleDisableVirtualKey)
	mux.HandleFunc("POST /admin/api/providers", s.handleCreateProvider)
	mux.HandleFunc("GET /admin/api/providers", s.handleListProviders)
	mux.HandleFunc("GET /admin/api/providers/{name}", s.handleGetProvider)
	mux.HandleFunc("POST /admin/api/providers/{name}/disable", s.handleDisableProvider)
	mux.HandleFunc("POST /admin/api/models", s.handleCreateModel)
	mux.HandleFunc("GET /admin/api/models", s.handleListModels)
	mux.HandleFunc("POST /admin/api/models/{name}/disable", s.handleDisableModel)
	mux.HandleFunc("GET /admin/api/prices", s.handleListPrices)
	mux.HandleFunc("PUT /admin/api/prices/{model}", s.handleUpsertPrice)
	mux.HandleFunc("DELETE /admin/api/prices/{model}", s.handleDeletePrice)
	mux.HandleFunc("GET /admin/api/usage", s.handleUsage)
	mux.HandleFunc("GET /admin/api/requests", s.handleRequests)
	mux.Handle("/", s.fallback())
	return mux
}

func (s *Server) fallback() http.Handler {
	spa := webui.Handler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			spa.ServeHTTP(w, r)
			return
		}
		s.handleUnknown(w, r)
	})
}

func (s *Server) handleUnknown(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" {
		http.NotFound(w, r)
		return
	}
	http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
}

func (s *Server) handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	s.handlePassthrough(w, r, "openai", s.Provider.ChatCompletions)
}

func (s *Server) handleMessages(w http.ResponseWriter, r *http.Request) {
	s.handlePassthrough(w, r, "anthropic", s.Provider.Messages)
}

func (s *Server) handlePassthrough(w http.ResponseWriter, r *http.Request, family string, invoke func(context.Context, []byte) (int, map[string]string, io.ReadCloser, error)) {
	ctx := r.Context()
	started := s.Now()
	startedWall := time.Now()

	token, ok := virtualKey(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_virtual_key"})
		return
	}
	vk, found, err := s.Store.LookupVirtualKey(ctx, token)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !found || vk.Disabled {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_virtual_key"})
		return
	}

	fabCtx, err := parseFabricContext(r.Header.Get("x-fabric-context"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_fabric_context"})
		return
	}
	if fabCtx.ProjectID != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "project_id_not_supported"})
		return
	}
	if fabCtx.TeamID != "" && fabCtx.TeamID != vk.Project {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "team_mismatch"})
		return
	}
	if ent, ok, err := s.Store.TeamEnterprise(ctx, vk.Project); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	} else if ok && ent.Disabled {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "enterprise_disabled"})
		return
	}

	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_body"})
		return
	}
	var head struct {
		Model  string `json:"model"`
		Stream bool   `json:"stream"`
	}
	if err := json.Unmarshal(raw, &head); err != nil || head.Model == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_model"})
		return
	}

	route, found, err := s.Store.LookupModel(ctx, head.Model)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !found || route.Disabled || route.ProviderDisabled || route.Family != family {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown_model"})
		return
	}
	price, found, err := s.Store.LookupPrice(ctx, head.Model)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !found {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no_price"})
		return
	}

	status, header, rc, err := s.callUpstream(ctx, family, route, raw, invoke)
	if err != nil {
		s.enqueueRequest(context.WithoutCancel(ctx), vk, head.Model, 0, 0, 0, 0, http.StatusBadGateway, started, time.Since(startedWall), fabCtx)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "provider"})
		return
	}
	defer rc.Close()

	for k, v := range header {
		w.Header().Set(k, v)
	}
	if head.Stream {
		if w.Header().Get("Content-Type") == "" {
			w.Header().Set("Content-Type", "text/event-stream")
		}
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.WriteHeader(status)

	var collected []byte
	if head.Stream {
		collected = copyFlush(w, rc)
	} else {
		body, _ := io.ReadAll(rc)
		collected = body
		_, _ = w.Write(body)
	}

	in, out, cached := parseUsage(collected)
	if head.Stream {
		sin, sout, scached := parseUsageFromSSE(collected)
		if sin != 0 {
			in = sin
		}
		if sout != 0 {
			out = sout
		}
		if scached != 0 {
			cached = scached
		}
	}
	cost := costCNY(in, out, cached, price)
	s.enqueueRequest(context.WithoutCancel(ctx), vk, head.Model, in, out, cached, cost, status, started, time.Since(startedWall), fabCtx)
}

func (s *Server) enqueueRequest(ctx context.Context, vk VirtualKeyRecord, model string, in, out, cached int, cost float64, status int, started time.Time, latency time.Duration, fabCtx fabricContext) {
	go s.appendRequest(ctx, vk, model, in, out, cached, cost, status, started, latency, fabCtx)
}

func (s *Server) appendRequest(ctx context.Context, vk VirtualKeyRecord, model string, in, out, cached int, cost float64, status int, started time.Time, latency time.Duration, fabCtx fabricContext) {
	_ = s.Store.AppendRequest(ctx, RequestRow{
		VirtualKeyHash: vk.Hash,
		Project:        vk.Project,
		Model:          model,
		InputTokens:    in,
		OutputTokens:   out,
		CachedTokens:   cached,
		CostCNY:        cost,
		Status:         status,
		LatencyMS:      latency.Milliseconds(),
		RunID:          fabCtx.RunID,
		TaskType:       fabCtx.TaskType,
		CreatedAt:      started,
	})
}

type fabricContext struct {
	ProjectID string `json:"project_id"`
	TeamID    string `json:"team_id"`
	TaskType  string `json:"task_type"`
	RunID     string `json:"run_id"`
}

func parseFabricContext(raw string) (fabricContext, error) {
	if strings.TrimSpace(raw) == "" {
		return fabricContext{}, nil
	}
	var ctx fabricContext
	if err := json.Unmarshal([]byte(raw), &ctx); err != nil {
		return fabricContext{}, err
	}
	return ctx, nil
}

func (s *Server) callUpstream(ctx context.Context, family string, route ModelRoute, raw []byte, fallback func(context.Context, []byte) (int, map[string]string, io.ReadCloser, error)) (int, map[string]string, io.ReadCloser, error) {
	if !s.UseRegistry || route.Provider == "" {
		return fallback(ctx, raw)
	}
	up, found, err := s.Store.GetUpstream(ctx, route.Provider)
	if err != nil || !found {
		return 0, nil, nil, err
	}
	key, err := OpenSecret(s.MasterKey, up.KeyCiphertext)
	if err != nil {
		return 0, nil, nil, err
	}
	live := NewLiveProvider(up.BaseURL, key)
	if family == "anthropic" {
		return live.Messages(ctx, raw)
	}
	return live.ChatCompletions(ctx, raw)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_body"})
		return
	}
	hash, found, err := s.Store.AdminPasswordHash(r.Context(), body.Username)
	if err != nil || !found || bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Password)) != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_credentials"})
		return
	}
	id := newSessionID()
	s.mu.Lock()
	s.sessions[id] = body.Username
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "fabric_session", Value: id, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "username": body.Username})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("fabric_session"); err == nil {
		s.mu.Lock()
		delete(s.sessions, c.Value)
		s.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "fabric_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	teams, err := s.Store.UserTeams(r.Context(), actor.Username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if teams == nil {
		teams = []string{}
	}
	writeJSON(w, http.StatusOK, publicUser(actor, teams))
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Username   string `json:"username"`
		Password   string `json:"password"`
		Role       string `json:"role"`
		Enterprise string `json:"enterprise"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_body"})
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	body.Password = strings.TrimSpace(body.Password)
	body.Role = strings.TrimSpace(body.Role)
	body.Enterprise = strings.TrimSpace(body.Enterprise)
	if body.Username == "" || body.Password == "" || body.Role == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_user"})
		return
	}
	if !canCreateUser(actor, body.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	if actor.Role == RoleEnterpriseAdmin {
		body.Enterprise = actor.Enterprise
	}
	if body.Role == RoleEnterpriseAdmin || body.Role == RoleTeamAdmin || body.Role == RoleDeveloper {
		if body.Enterprise == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_enterprise"})
			return
		}
	}
	if body.Role == RoleSuperAdmin {
		body.Enterprise = ""
	}
	rec := UserRecord{
		Username:     body.Username,
		Role:         body.Role,
		Enterprise:   body.Enterprise,
		PasswordHash: HashAdminPassword(body.Password),
	}
	if err := s.Store.CreateUser(r.Context(), rec); err != nil {
		if errors.Is(err, errDuplicate) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "duplicate"})
			return
		}
		if errors.Is(err, errUnknownEnterprise) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown_enterprise"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	writeJSON(w, http.StatusCreated, publicUser(rec, nil))
}

func (s *Server) handleAddMember(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	team := r.PathValue("name")
	var body struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Username) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_username"})
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	if !s.canManageMember(r.Context(), actor, team, body.Username) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	if err := s.Store.AddMember(r.Context(), body.Username, team); err != nil {
		if errors.Is(err, errUnknownProject) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown_team"})
			return
		}
		if errors.Is(err, errUnknownUser) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown_user"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"username": body.Username, "team": team})
}

func (s *Server) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	team := r.PathValue("name")
	username := r.PathValue("username")
	if !s.canManageMember(r.Context(), actor, team, username) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	okDel, err := s.Store.RemoveMember(r.Context(), username, team)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !okDel {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) canManageMember(ctx context.Context, actor UserRecord, team, username string) bool {
	ent, found, err := s.Store.TeamEnterprise(ctx, team)
	if err != nil || !found {
		return false
	}
	target, found, err := s.Store.GetUser(ctx, username)
	if err != nil || !found {
		return false
	}
	if target.Enterprise != ent.Name {
		return false
	}
	switch actor.Role {
	case RoleEnterpriseAdmin:
		return actor.Enterprise == ent.Name && (target.Role == RoleTeamAdmin || target.Role == RoleDeveloper)
	case RoleTeamAdmin:
		if target.Role != RoleDeveloper {
			return false
		}
		teams, err := s.Store.UserTeams(ctx, actor.Username)
		if err != nil {
			return false
		}
		return actor.Enterprise == ent.Name && containsString(teams, team)
	default:
		return false
	}
}

func containsString(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func canCreateUser(actor UserRecord, role string) bool {
	switch actor.Role {
	case RoleSuperAdmin:
		return role == RoleEnterpriseAdmin || role == RoleSuperAdmin
	case RoleEnterpriseAdmin:
		return role == RoleTeamAdmin || role == RoleDeveloper
	default:
		return false
	}
}

func publicUser(u UserRecord, teams []string) map[string]any {
	out := map[string]any{
		"username": u.Username,
		"name":     u.Username,
		"role":     u.Role,
	}
	if u.Enterprise != "" {
		out["enterprise"] = u.Enterprise
	}
	if teams != nil {
		out["teams"] = teams
	}
	return out
}

func (s *Server) handleCreateEnterprise(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_name"})
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_name"})
		return
	}
	if err := s.Store.CreateEnterprise(r.Context(), body.Name); err != nil {
		if errors.Is(err, errDuplicate) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "duplicate"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"name": body.Name})
}

func (s *Server) handleListEnterprises(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if actor.Role != RoleSuperAdmin && actor.Role != RoleEnterpriseAdmin {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	ents, err := s.Store.ListEnterprises(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	type item struct {
		Name     string `json:"name"`
		Disabled bool   `json:"disabled"`
	}
	out := make([]item, 0, len(ents))
	for _, e := range ents {
		if actor.Role == RoleEnterpriseAdmin && e.Name != actor.Enterprise {
			continue
		}
		out = append(out, item{Name: e.Name, Disabled: e.Disabled})
	}
	writeJSON(w, http.StatusOK, map[string]any{"enterprises": out})
}

func (s *Server) handleDisableEnterprise(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	ok, err := s.Store.DisableEnterprise(r.Context(), r.PathValue("name"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "fabric"})
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if actor.Role != RoleSuperAdmin && actor.Role != RoleEnterpriseAdmin {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_name"})
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_name"})
		return
	}
	enterprise := SeedEnterprise
	if actor.Role == RoleEnterpriseAdmin {
		enterprise = actor.Enterprise
	}
	if err := s.Store.CreateProject(r.Context(), body.Name, enterprise); err != nil {
		if errors.Is(err, errUnknownEnterprise) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown_enterprise"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"name": body.Name})
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	names, err := s.Store.ListProjects(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	visible, err := s.visibleTeams(r.Context(), actor, names)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	type item struct {
		Name string `json:"name"`
	}
	out := make([]item, 0, len(visible))
	for _, n := range visible {
		out = append(out, item{Name: n})
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": out})
}

func (s *Server) canSeeTeam(ctx context.Context, actor UserRecord, team string) (bool, error) {
	names, err := s.Store.ListProjects(ctx)
	if err != nil {
		return false, err
	}
	visible, err := s.visibleTeams(ctx, actor, names)
	if err != nil {
		return false, err
	}
	return containsString(visible, team), nil
}

func (s *Server) visibleTeams(ctx context.Context, actor UserRecord, names []string) ([]string, error) {
	if actor.Role == RoleSuperAdmin {
		return names, nil
	}
	mine := map[string]struct{}{}
	if actor.Role == RoleTeamAdmin || actor.Role == RoleDeveloper {
		teams, err := s.Store.UserTeams(ctx, actor.Username)
		if err != nil {
			return nil, err
		}
		for _, t := range teams {
			mine[t] = struct{}{}
		}
	}
	out := make([]string, 0, len(names))
	for _, name := range names {
		ent, ok, err := s.Store.TeamEnterprise(ctx, name)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		switch actor.Role {
		case RoleEnterpriseAdmin:
			if ent.Name == actor.Enterprise {
				out = append(out, name)
			}
		case RoleTeamAdmin, RoleDeveloper:
			if _, yes := mine[name]; yes {
				out = append(out, name)
			}
		}
	}
	return out, nil
}

func (s *Server) handleCreateVirtualKey(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Project string `json:"project"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Project == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_project"})
		return
	}
	exists, err := s.Store.ProjectExists(r.Context(), body.Project)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !exists {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown_project"})
		return
	}
	if allowed, err := s.canSeeTeam(r.Context(), actor, body.Project); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	} else if !allowed {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	plain := newVirtualKeyPlaintext()
	rec := VirtualKeyRecord{Hash: HashVirtualKey(plain), Project: body.Project}
	if err := s.Store.CreateVirtualKey(r.Context(), rec); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"hash":      rec.Hash,
		"project":   rec.Project,
		"disabled":  false,
		"plaintext": plain,
	})
}

func (s *Server) handleListVirtualKeys(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	keys, err := s.Store.ListVirtualKeys(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	visible := make([]VirtualKeyRecord, 0, len(keys))
	for _, rec := range keys {
		allowed, err := s.canSeeTeam(r.Context(), actor, rec.Project)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
			return
		}
		if allowed {
			visible = append(visible, rec)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": vkPublicList(visible)})
}

func (s *Server) handleGetVirtualKey(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	rec, found, err := s.Store.GetVirtualKey(r.Context(), r.PathValue("hash"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	if allowed, err := s.canSeeTeam(r.Context(), actor, rec.Project); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	} else if !allowed {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	writeJSON(w, http.StatusOK, vkPublic(rec))
}

func (s *Server) handleDisableVirtualKey(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	rec, found, err := s.Store.GetVirtualKey(r.Context(), r.PathValue("hash"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	if allowed, err := s.canSeeTeam(r.Context(), actor, rec.Project); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	} else if !allowed {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	ok, err = s.Store.DisableVirtualKey(r.Context(), r.PathValue("hash"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "disabled"})
}

func vkPublic(rec VirtualKeyRecord) map[string]any {
	return map[string]any{"hash": rec.Hash, "project": rec.Project, "disabled": rec.Disabled}
}

func vkPublicList(keys []VirtualKeyRecord) []map[string]any {
	out := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		out = append(out, vkPublic(k))
	}
	return out
}

func newVirtualKeyPlaintext() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return "sk-fab-" + hex.EncodeToString(b[:])
}

func (s *Server) handleCreateProvider(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	var body struct {
		Name    string `json:"name"`
		Family  string `json:"family"`
		BaseURL string `json:"base_url"`
		APIKey  string `json:"api_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_body"})
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" || (body.Family != "openai" && body.Family != "anthropic") || body.BaseURL == "" || body.APIKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_provider"})
		return
	}
	sealed, err := SealSecret(s.MasterKey, body.APIKey)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "encrypt"})
		return
	}
	err = s.Store.CreateUpstream(r.Context(), Upstream{
		Name: body.Name, Family: body.Family, BaseURL: body.BaseURL, KeyCiphertext: sealed,
	})
	if err == errDuplicate {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "duplicate"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	writeJSON(w, http.StatusCreated, publicUpstream(Upstream{Name: body.Name, Family: body.Family, BaseURL: body.BaseURL}))
}

func (s *Server) handleListProviders(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	list, err := s.Store.ListUpstreams(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, u := range list {
		out = append(out, publicUpstream(u))
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": out})
}

func (s *Server) handleGetProvider(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	u, found, err := s.Store.GetUpstream(r.Context(), r.PathValue("name"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	writeJSON(w, http.StatusOK, publicUpstream(u))
}

func (s *Server) handleDisableProvider(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	ok, err := s.Store.DisableUpstream(r.Context(), r.PathValue("name"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "disabled"})
}

func (s *Server) handleCreateModel(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	var body struct {
		Name     string `json:"name"`
		Family   string `json:"family"`
		Provider string `json:"provider"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_model"})
		return
	}
	up, found, err := s.Store.GetUpstream(r.Context(), body.Provider)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !found || up.Family != body.Family {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_provider"})
		return
	}
	err = s.Store.CreateModel(r.Context(), ModelRoute{Name: body.Name, Family: body.Family, Provider: body.Provider})
	if err == errDuplicate {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "duplicate"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"name": body.Name, "family": body.Family, "provider": body.Provider})
}

func (s *Server) handleListModels(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	list, err := s.Store.ListModels(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	type item struct {
		Name     string `json:"name"`
		Family   string `json:"family"`
		Provider string `json:"provider"`
		Disabled bool   `json:"disabled"`
	}
	out := make([]item, 0, len(list))
	for _, m := range list {
		out = append(out, item{Name: m.Name, Family: m.Family, Provider: m.Provider, Disabled: m.Disabled})
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": out})
}

func (s *Server) handleDisableModel(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	ok, err := s.Store.DisableModel(r.Context(), r.PathValue("name"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "disabled"})
}

func publicUpstream(u Upstream) map[string]any {
	return map[string]any{
		"name":     u.Name,
		"family":   u.Family,
		"base_url": u.BaseURL,
		"disabled": u.Disabled,
	}
}

func (s *Server) handleListPrices(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	prices, err := s.Store.ListPrices(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if prices == nil {
		prices = []Price{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"prices": prices})
}

func (s *Server) handleUpsertPrice(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	model := r.PathValue("model")
	_, found, err := s.Store.LookupModel(r.Context(), model)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !found {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown_model"})
		return
	}
	var body Price
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_body"})
		return
	}
	body.Model = model
	if err := s.Store.UpsertPrice(r.Context(), body); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) handleDeletePrice(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireRoles(w, r, RoleSuperAdmin); !ok {
		return
	}
	ok, err := s.Store.DeletePrice(r.Context(), r.PathValue("model"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleUsage(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	project := r.URL.Query().Get("project")
	if project != "" {
		if allowed, err := s.canSeeTeam(r.Context(), actor, project); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
			return
		} else if !allowed {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
			return
		}
	}
	day := r.URL.Query().Get("day")
	if day == "" {
		day = s.Now().In(shanghai()).Format("2006-01-02")
	}
	cells, err := s.Store.UsageByProjectModelDay(r.Context(), project, day)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if cells == nil {
		cells = []UsageCell{}
	}
	if project == "" {
		filtered := cells[:0]
		for _, cell := range cells {
			allowed, err := s.canSeeTeam(r.Context(), actor, cell.Project)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
				return
			}
			if allowed {
				filtered = append(filtered, cell)
			}
		}
		cells = filtered
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": project, "day": day, "rows": cells})
}

func (s *Server) handleRequests(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	project := r.URL.Query().Get("project")
	if project == "" {
		project = SeedProject
	}
	if allowed, err := s.canSeeTeam(r.Context(), actor, project); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	} else if !allowed {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	rows, err := s.Store.ListRequests(r.Context(), project)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if rows == nil {
		rows = []RequestRow{}
	}
	type view struct {
		VirtualKeyHash string    `json:"virtual_key_hash"`
		Project        string    `json:"project"`
		Model          string    `json:"model"`
		InputTokens    int       `json:"input_tokens"`
		OutputTokens   int       `json:"output_tokens"`
		CachedTokens   int       `json:"cached_tokens"`
		CostCNY        float64   `json:"cost_cny"`
		Status         int       `json:"status"`
		LatencyMS      int64     `json:"latency_ms"`
		RunID          string    `json:"run_id"`
		TaskType       string    `json:"task_type"`
		CreatedAt      time.Time `json:"created_at"`
	}
	out := make([]view, 0, len(rows))
	for _, row := range rows {
		out = append(out, view{
			VirtualKeyHash: row.VirtualKeyHash,
			Project:        row.Project,
			Model:          row.Model,
			InputTokens:    row.InputTokens,
			OutputTokens:   row.OutputTokens,
			CachedTokens:   row.CachedTokens,
			CostCNY:        row.CostCNY,
			Status:         row.Status,
			LatencyMS:      row.LatencyMS,
			RunID:          row.RunID,
			TaskType:       row.TaskType,
			CreatedAt:      row.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": project, "requests": out})
}

func (s *Server) authed(r *http.Request) bool {
	_, ok := s.sessionUser(r)
	return ok
}

func (s *Server) requireRoles(w http.ResponseWriter, r *http.Request, roles ...string) (UserRecord, bool) {
	actor, ok := s.requireUser(w, r)
	if !ok {
		return UserRecord{}, false
	}
	for _, role := range roles {
		if actor.Role == role {
			return actor, true
		}
	}
	writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
	return UserRecord{}, false
}

func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (UserRecord, bool) {
	name, ok := s.sessionUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return UserRecord{}, false
	}
	rec, found, err := s.Store.GetUser(r.Context(), name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return UserRecord{}, false
	}
	if !found {
		// Seed login via legacy admins table.
		return UserRecord{Username: name, Role: RoleSuperAdmin}, true
	}
	if rec.Disabled {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return UserRecord{}, false
	}
	return rec, true
}

func (s *Server) sessionUser(r *http.Request) (string, bool) {
	c, err := r.Cookie("fabric_session")
	if err != nil {
		return "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.sessions[c.Value]
	return user, ok
}

func virtualKey(r *http.Request) (string, bool) {
	if tok, ok := bearer(r.Header.Get("Authorization")); ok {
		return tok, true
	}
	if key := strings.TrimSpace(r.Header.Get("x-api-key")); key != "" {
		return key, true
	}
	return "", false
}

func bearer(h string) (string, bool) {
	const p = "Bearer "
	if !strings.HasPrefix(h, p) {
		return "", false
	}
	tok := strings.TrimSpace(h[len(p):])
	return tok, tok != ""
}

func copyFlush(w http.ResponseWriter, src io.Reader) []byte {
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 4096)
	var collected []byte
	for {
		n, err := src.Read(buf)
		if n > 0 {
			collected = append(collected, buf[:n]...)
			_, werr := w.Write(buf[:n])
			if flusher != nil {
				flusher.Flush()
			}
			if werr != nil {
				return collected
			}
		}
		if err != nil {
			return collected
		}
	}
}

func parseUsageFromSSE(raw []byte) (input, output, cached int) {
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		in, out, c := parseUsage([]byte(payload))
		if in != 0 {
			input = in
		}
		if out != 0 {
			output = out
		}
		if c != 0 {
			cached = c
		}
	}
	return input, output, cached
}

func parseUsage(body []byte) (input, output, cached int) {
	var payload struct {
		Usage   usageBlock `json:"usage"`
		Message struct {
			Usage usageBlock `json:"usage"`
		} `json:"message"`
	}
	_ = json.Unmarshal(body, &payload)
	u := payload.Usage
	if u.empty() {
		u = payload.Message.Usage
	}
	return u.input(), u.output(), u.cached()
}

type usageBlock struct {
	PromptTokens         int `json:"prompt_tokens"`
	CompletionTokens     int `json:"completion_tokens"`
	InputTokens          int `json:"input_tokens"`
	OutputTokens         int `json:"output_tokens"`
	CacheReadInputTokens int `json:"cache_read_input_tokens"`
	PromptTokensDetails  struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
}

func (u usageBlock) empty() bool {
	return u.input() == 0 && u.output() == 0 && u.cached() == 0
}

func (u usageBlock) input() int {
	if u.PromptTokens != 0 {
		return u.PromptTokens
	}
	return u.InputTokens
}

func (u usageBlock) output() int {
	if u.CompletionTokens != 0 {
		return u.CompletionTokens
	}
	return u.OutputTokens
}

func (u usageBlock) cached() int {
	if u.PromptTokensDetails.CachedTokens != 0 {
		return u.PromptTokensDetails.CachedTokens
	}
	return u.CacheReadInputTokens
}

func costCNY(input, output, cached int, price Price) float64 {
	const perMillion = 1_000_000.0
	return float64(input)/perMillion*price.InputCNY +
		float64(output)/perMillion*price.OutputCNY +
		float64(cached)/perMillion*price.CachedCNY
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func newSessionID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func HashAdminPassword(password string) string {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		panic(err)
	}
	return string(h)
}
