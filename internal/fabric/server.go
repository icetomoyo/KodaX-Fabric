package fabric

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type Server struct {
	Store       Store
	Provider    Provider
	Now         func() time.Time
	MasterKey   []byte
	UseRegistry bool

	mu       sync.Mutex
	sessions map[string]struct{}
}

func NewServer(store Store, provider Provider) *Server {
	return &Server{
		Store:     store,
		Provider:  provider,
		Now:       func() time.Time { return time.Now().UTC() },
		MasterKey: TestMasterKey,
		sessions:  map[string]struct{}{},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", s.handleChatCompletions)
	mux.HandleFunc("POST /v1/messages", s.handleMessages)
	mux.HandleFunc("POST /admin/api/login", s.handleLogin)
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
	mux.HandleFunc("GET /admin", s.handleAdminPage)
	mux.HandleFunc("/", s.handleUnknown)
	return mux
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
	if fabCtx.ProjectID != "" && fabCtx.ProjectID != vk.Project {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "project_mismatch"})
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
		s.appendRequest(ctx, vk, head.Model, 0, 0, 0, 0, http.StatusBadGateway, started, fabCtx)
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
	s.appendRequest(context.WithoutCancel(ctx), vk, head.Model, in, out, cached, cost, status, started, fabCtx)
}

func (s *Server) appendRequest(ctx context.Context, vk VirtualKeyRecord, model string, in, out, cached int, cost float64, status int, started time.Time, fabCtx fabricContext) {
	_ = s.Store.AppendRequest(ctx, RequestRow{
		VirtualKeyHash: vk.Hash,
		Project:        vk.Project,
		Model:          model,
		InputTokens:    in,
		OutputTokens:   out,
		CachedTokens:   cached,
		CostCNY:        cost,
		Status:         status,
		RunID:          fabCtx.RunID,
		TaskType:       fabCtx.TaskType,
		CreatedAt:      started,
	})
}

type fabricContext struct {
	ProjectID string `json:"project_id"`
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
	s.sessions[id] = struct{}{}
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "fabric_session", Value: id, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	if err := s.Store.CreateProject(r.Context(), body.Name); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"name": body.Name})
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	names, err := s.Store.ListProjects(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	type item struct {
		Name string `json:"name"`
	}
	out := make([]item, 0, len(names))
	for _, n := range names {
		out = append(out, item{Name: n})
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": out})
}

func (s *Server) handleCreateVirtualKey(w http.ResponseWriter, r *http.Request) {
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var body struct {
		Project string `json:"project"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Project == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_project"})
		return
	}
	ok, err := s.Store.ProjectExists(r.Context(), body.Project)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown_project"})
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	keys, err := s.Store.ListVirtualKeys(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
		return
	}
	if keys == nil {
		keys = []VirtualKeyRecord{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": vkPublicList(keys)})
}

func (s *Server) handleGetVirtualKey(w http.ResponseWriter, r *http.Request) {
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	writeJSON(w, http.StatusOK, vkPublic(rec))
}

func (s *Server) handleDisableVirtualKey(w http.ResponseWriter, r *http.Request) {
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	ok, err := s.Store.DisableVirtualKey(r.Context(), r.PathValue("hash"))
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	project := r.URL.Query().Get("project")
	if project == "" {
		project = SeedProject
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
	writeJSON(w, http.StatusOK, map[string]any{"project": project, "day": day, "rows": cells})
}

func (s *Server) handleRequests(w http.ResponseWriter, r *http.Request) {
	if !s.authed(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	project := r.URL.Query().Get("project")
	if project == "" {
		project = SeedProject
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
		VirtualKeyHash string  `json:"virtual_key_hash"`
		Project        string  `json:"project"`
		Model          string  `json:"model"`
		InputTokens    int     `json:"input_tokens"`
		OutputTokens   int     `json:"output_tokens"`
		CachedTokens   int     `json:"cached_tokens"`
		CostCNY        float64 `json:"cost_cny"`
		Status         int     `json:"status"`
		RunID          string  `json:"run_id"`
		TaskType       string  `json:"task_type"`
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
			RunID:          row.RunID,
			TaskType:       row.TaskType,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": project, "requests": out})
}

func (s *Server) handleAdminPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, adminHTML)
}

func (s *Server) authed(r *http.Request) bool {
	c, err := r.Cookie("fabric_session")
	if err != nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.sessions[c.Value]
	return ok
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

const adminHTML = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>Fabric 管理台</title>
<body>
<h1>Fabric 管理台</h1>
<form id="login">
  <input name="username" value="admin" />
  <input name="password" type="password" value="fabric-admin" />
  <button>登录</button>
</form>
<h2>Project</h2>
<form id="proj">
  <input name="name" value="billing" />
  <button>创建</button>
</form>
<ul id="projects"></ul>
<h2>Virtual Key</h2>
<form id="vk">
  <input name="project" value="demo" />
  <button>创建</button>
</form>
<pre id="created"></pre>
<ul id="keys"></ul>
<h2>Provider</h2>
<form id="prov">
  <input name="name" value="ds" />
  <input name="family" value="openai" />
  <input name="base_url" value="https://api.deepseek.com" />
  <input name="api_key" type="password" />
  <button>登记</button>
</form>
<ul id="providers"></ul>
<h2>Model</h2>
<form id="mod">
  <input name="name" value="my-flash" />
  <input name="family" value="openai" />
  <input name="provider" value="ds" />
  <button>映射</button>
</form>
<ul id="models"></ul>
<h2>价格表</h2>
<form id="price">
  <input name="model" value="gpt-4o-mini" />
  <input name="input_cny" value="1" />
  <input name="output_cny" value="2" />
  <input name="cached_cny" value="0.1" />
  <button>保存</button>
</form>
<ul id="prices"></ul>
<h2>用量报表</h2>
<pre id="out"></pre>
<script>
const out = document.getElementById('out');
const created = document.getElementById('created');
const keys = document.getElementById('keys');
async function refresh() {
  const u = await fetch('/admin/api/usage');
  out.textContent = await u.text();
  const p = await fetch('/admin/api/projects');
  const pdata = await p.json();
  const plist = document.getElementById('projects');
  plist.innerHTML = '';
  (pdata.projects || []).forEach(row => {
    const li = document.createElement('li');
    li.textContent = row.name;
    plist.appendChild(li);
  });
  const ups = await fetch('/admin/api/providers');
  const updata = await ups.json();
  const uplist = document.getElementById('providers');
  uplist.innerHTML = '';
  (updata.providers || []).forEach(row => {
    const li = document.createElement('li');
    li.textContent = row.name + ' ' + row.family + ' ' + row.base_url + (row.disabled ? ' 已停用' : '');
    if (!row.disabled) {
      const b = document.createElement('button');
      b.textContent = '停用';
      b.onclick = async () => { await fetch('/admin/api/providers/' + row.name + '/disable', {method:'POST'}); refresh(); };
      li.appendChild(b);
    }
    uplist.appendChild(li);
  });
  const mods = await fetch('/admin/api/models');
  const mdata = await mods.json();
  const mlist = document.getElementById('models');
  mlist.innerHTML = '';
  (mdata.models || []).forEach(row => {
    const li = document.createElement('li');
    li.textContent = row.name + ' → ' + row.provider + (row.disabled ? ' 已停用' : '');
    if (!row.disabled) {
      const b = document.createElement('button');
      b.textContent = '停用';
      b.onclick = async () => { await fetch('/admin/api/models/' + row.name + '/disable', {method:'POST'}); refresh(); };
      li.appendChild(b);
    }
    mlist.appendChild(li);
  });
  const pr = await fetch('/admin/api/prices');
  const pricedata = await pr.json();
  const pricelist = document.getElementById('prices');
  pricelist.innerHTML = '';
  (pricedata.prices || []).forEach(row => {
    const li = document.createElement('li');
    li.textContent = row.model + ' in=' + row.input_cny + ' out=' + row.output_cny + ' cache=' + row.cached_cny;
    const b = document.createElement('button');
    b.textContent = '删除';
    b.onclick = async () => {
      await fetch('/admin/api/prices/' + row.model, {method:'DELETE'});
      refresh();
    };
    li.appendChild(b);
    pricelist.appendChild(li);
  });
  const k = await fetch('/admin/api/virtual-keys');
  const data = await k.json();
  keys.innerHTML = '';
  (data.keys || []).forEach(row => {
    const li = document.createElement('li');
    li.textContent = row.hash.slice(0,12) + '… ' + row.project + (row.disabled ? ' 已停用' : '');
    if (!row.disabled) {
      const b = document.createElement('button');
      b.textContent = '停用';
      b.onclick = async () => {
        await fetch('/admin/api/virtual-keys/' + row.hash + '/disable', {method:'POST'});
        refresh();
      };
      li.appendChild(b);
    }
    keys.appendChild(li);
  });
}
document.getElementById('login').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await fetch('/admin/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:fd.get('username'), password:fd.get('password')})});
  refresh();
};
document.getElementById('proj').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await fetch('/admin/api/projects', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:fd.get('name')})});
  refresh();
};
document.getElementById('prov').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await fetch('/admin/api/providers', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:fd.get('name'), family:fd.get('family'), base_url:fd.get('base_url'), api_key:fd.get('api_key')})});
  refresh();
};
document.getElementById('mod').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await fetch('/admin/api/models', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:fd.get('name'), family:fd.get('family'), provider:fd.get('provider')})});
  refresh();
};
document.getElementById('price').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await fetch('/admin/api/prices/' + fd.get('model'), {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({input_cny:Number(fd.get('input_cny')), output_cny:Number(fd.get('output_cny')), cached_cny:Number(fd.get('cached_cny'))})});
  refresh();
};
document.getElementById('vk').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const r = await fetch('/admin/api/virtual-keys', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({project:fd.get('project')})});
  created.textContent = await r.text();
  refresh();
};
</script>
</body>
</html>
`
