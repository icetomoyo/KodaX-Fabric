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
	mux.HandleFunc("POST /v1/messages", s.handleMessages)
	mux.HandleFunc("POST /admin/api/login", s.handleLogin)
	mux.HandleFunc("POST /admin/api/virtual-keys", s.handleCreateVirtualKey)
	mux.HandleFunc("GET /admin/api/virtual-keys", s.handleListVirtualKeys)
	mux.HandleFunc("GET /admin/api/virtual-keys/{hash}", s.handleGetVirtualKey)
	mux.HandleFunc("POST /admin/api/virtual-keys/{hash}/disable", s.handleDisableVirtualKey)
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
	if !found || route.Disabled || route.Family != family {
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

	status, header, rc, err := invoke(ctx, raw)
	if err != nil {
		s.appendRequest(ctx, vk, head.Model, 0, 0, 0, 0, http.StatusBadGateway, started)
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
	s.appendRequest(context.WithoutCancel(ctx), vk, head.Model, in, out, cached, cost, status, started)
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
<h2>Virtual Key</h2>
<form id="vk">
  <input name="project" value="demo" />
  <button>创建</button>
</form>
<pre id="created"></pre>
<ul id="keys"></ul>
<h2>用量报表</h2>
<pre id="out"></pre>
<script>
const out = document.getElementById('out');
const created = document.getElementById('created');
const keys = document.getElementById('keys');
async function refresh() {
  const u = await fetch('/admin/api/usage');
  out.textContent = await u.text();
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
