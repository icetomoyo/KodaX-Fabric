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
	Store    Store
	Provider Provider
	Now      func() time.Time

	mu       sync.Mutex
	sessions map[string]struct{}
}

func NewServer(store Store, provider Provider) *Server {
	return &Server{
		Store:    store,
		Provider: provider,
		Now:      func() time.Time { return time.Now().UTC() },
		sessions: map[string]struct{}{},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", s.handleChatCompletions)
	mux.HandleFunc("POST /admin/api/login", s.handleLogin)
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
	ctx := r.Context()
	started := s.Now()

	token, ok := bearer(r.Header.Get("Authorization"))
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

	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_body"})
		return
	}
	var head struct {
		Model string `json:"model"`
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
	if !found || route.Disabled || route.Family != "openai" {
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

	status, header, body, err := s.Provider.ChatCompletions(ctx, raw)
	if err != nil {
		s.appendRequest(ctx, vk, head.Model, 0, 0, 0, 0, http.StatusBadGateway, started)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "provider"})
		return
	}

	in, out, cached := parseUsage(body)
	cost := costCNY(in, out, cached, price)
	s.appendRequest(ctx, vk, head.Model, in, out, cached, cost, status, started)

	for k, v := range header {
		w.Header().Set(k, v)
	}
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func (s *Server) appendRequest(ctx context.Context, vk VirtualKeyRecord, model string, in, out, cached int, cost float64, status int, started time.Time) {
	_ = s.Store.AppendRequest(ctx, RequestRow{
		VirtualKeyHash: vk.Hash,
		Project:        vk.Project,
		Model:          model,
		InputTokens:    in,
		OutputTokens:   out,
		CachedTokens:   cached,
		CostCNY:        cost,
		Status:         status,
		CreatedAt:      started,
	})
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

func bearer(h string) (string, bool) {
	const p = "Bearer "
	if !strings.HasPrefix(h, p) {
		return "", false
	}
	tok := strings.TrimSpace(h[len(p):])
	return tok, tok != ""
}

func parseUsage(body []byte) (input, output, cached int) {
	var payload struct {
		Usage struct {
			PromptTokens        int `json:"prompt_tokens"`
			CompletionTokens    int `json:"completion_tokens"`
			PromptTokensDetails struct {
				CachedTokens int `json:"cached_tokens"`
			} `json:"prompt_tokens_details"`
		} `json:"usage"`
	}
	_ = json.Unmarshal(body, &payload)
	return payload.Usage.PromptTokens, payload.Usage.CompletionTokens, payload.Usage.PromptTokensDetails.CachedTokens
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
<title>Fabric 用量</title>
<body>
<h1>用量报表</h1>
<form id="login">
  <input name="username" value="admin" />
  <input name="password" type="password" value="fabric-admin" />
  <button>登录</button>
</form>
<pre id="out"></pre>
<script>
const out = document.getElementById('out');
document.getElementById('login').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await fetch('/admin/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:fd.get('username'), password:fd.get('password')})});
  const r = await fetch('/admin/api/usage');
  out.textContent = await r.text();
};
</script>
</body>
</html>
`
