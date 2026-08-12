package admin

import (
	"encoding/json"
	"net/http"
	"strconv"
)

type API struct {
	Cat      *Catalog
	Sessions *Sessions
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	mux.HandleFunc("POST /api/v1/auth/register", a.register)
	mux.HandleFunc("GET /api/v1/auth/me", a.me)

	mux.HandleFunc("GET /api/v1/providers", a.need("admin", a.listProviders))
	mux.HandleFunc("POST /api/v1/providers", a.need("admin", a.createProvider))
	mux.HandleFunc("GET /api/v1/provider-keys", a.need("admin", a.listKeys))
	mux.HandleFunc("POST /api/v1/provider-keys", a.need("admin", a.createKey))
	mux.HandleFunc("POST /api/v1/provider-keys/{id}/status", a.need("admin", a.keyStatus))

	mux.HandleFunc("GET /api/v1/pools", a.need("", a.listPools))
	mux.HandleFunc("POST /api/v1/pools", a.need("admin", a.createPool))

	mux.HandleFunc("GET /api/v1/channels", a.need("admin", a.listChannels))
	mux.HandleFunc("POST /api/v1/channels", a.need("admin", a.createChannel))
	mux.HandleFunc("POST /api/v1/channels/{id}", a.need("admin", a.updateChannel))

	mux.HandleFunc("GET /api/v1/virtual-keys", a.need("admin", a.listVKs))
	mux.HandleFunc("POST /api/v1/virtual-keys", a.need("admin", a.createVK))
	mux.HandleFunc("POST /api/v1/virtual-keys/{id}/revoke", a.need("admin", a.revokeVK))

	mux.HandleFunc("GET /api/v1/vk-applications", a.need("admin", a.listApps))
	mux.HandleFunc("POST /api/v1/vk-applications/{id}/approve", a.need("admin", a.approveApp))

	mux.HandleFunc("POST /api/v1/me/vk-applications", a.need("developer", a.createApp))
	mux.HandleFunc("GET /api/v1/me/vk-applications", a.need("developer", a.myApps))
	mux.HandleFunc("POST /api/v1/me/vk-applications/{id}/reveal", a.need("developer", a.revealApp))
	return mux
}

func (a *API) need(role string, next func(http.ResponseWriter, *http.Request, session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ss, ok := a.Sessions.Get(cookieToken(r))
		if !ok {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		if role != "" && ss.Role != role && !(role == "developer" && ss.Role == "admin") {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}
		next(w, r, ss)
	}
}

func writeOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": v})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phone    string `json:"phone"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &in); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	op, err := a.Cat.FindOperator(r.Context(), in.Phone)
	if err != nil || op == nil || !checkPassword(op.PasswordHash, in.Password) {
		http.Error(w, `{"error":"invalid credentials"}`, 401)
		return
	}
	tok := a.Sessions.Put(op.ID, op.Role, op.Phone, op.Name)
	setSessionCookie(w, tok)
	writeOK(w, map[string]any{"role": op.Role, "phone": op.Phone, "name": op.Name})
}

func (a *API) register(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phone    string `json:"phone"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := readJSON(r, &in); err != nil || in.Phone == "" || in.Password == "" {
		http.Error(w, "bad json", 400)
		return
	}
	if existing, _ := a.Cat.FindOperator(r.Context(), in.Phone); existing != nil {
		http.Error(w, `{"error":"phone exists"}`, 409)
		return
	}
	op, err := a.Cat.CreateOperator(r.Context(), in.Phone, in.Name, "developer", in.Password)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	tok := a.Sessions.Put(op.ID, op.Role, op.Phone, op.Name)
	setSessionCookie(w, tok)
	writeOK(w, map[string]any{"role": op.Role, "phone": op.Phone})
}

func (a *API) me(w http.ResponseWriter, r *http.Request) {
	ss, ok := a.Sessions.Get(cookieToken(r))
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, 401)
		return
	}
	writeOK(w, map[string]any{"role": ss.Role, "phone": ss.Phone, "name": ss.Name})
}

func (a *API) listProviders(w http.ResponseWriter, r *http.Request, _ session) {
	rows, err := a.Cat.ListProviders(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, rows)
}

func (a *API) createProvider(w http.ResponseWriter, r *http.Request, _ session) {
	var in struct {
		Code           string `json:"code"`
		Name           string `json:"name"`
		DefaultBaseURL string `json:"default_base_url"`
	}
	if err := readJSON(r, &in); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	id, err := a.Cat.CreateProvider(r.Context(), in.Code, in.Name, in.DefaultBaseURL)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, map[string]any{"id": id})
}

func (a *API) listKeys(w http.ResponseWriter, r *http.Request, _ session) {
	rows, err := a.Cat.ListProviderKeys(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, rows)
}

func (a *API) createKey(w http.ResponseWriter, r *http.Request, _ session) {
	var in struct {
		ProviderCode string `json:"provider_code"`
		Label        string `json:"label"`
		Secret       string `json:"secret"`
		Status       string `json:"status"`
	}
	if err := readJSON(r, &in); err != nil || in.Secret == "" {
		http.Error(w, "bad json", 400)
		return
	}
	id, err := a.Cat.CreateProviderKey(r.Context(), in.ProviderCode, in.Label, in.Secret, in.Status)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, map[string]any{"id": id})
}

func (a *API) keyStatus(w http.ResponseWriter, r *http.Request, _ session) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var in struct {
		Status string `json:"status"`
	}
	if err := readJSON(r, &in); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	if err := a.Cat.UpdateProviderKeyStatus(r.Context(), id, in.Status); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, true)
}

func (a *API) listPools(w http.ResponseWriter, r *http.Request, _ session) {
	rows, err := a.Cat.ListPools(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, rows)
}

func (a *API) createPool(w http.ResponseWriter, r *http.Request, _ session) {
	var in struct {
		Name      string `json:"name"`
		GroupName string `json:"group_name"`
	}
	if err := readJSON(r, &in); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	id, err := a.Cat.CreatePool(r.Context(), in.Name, in.GroupName)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, map[string]any{"id": id})
}

func (a *API) listChannels(w http.ResponseWriter, r *http.Request, _ session) {
	rows, err := a.Cat.ListChannels(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, rows)
}

func (a *API) createChannel(w http.ResponseWriter, r *http.Request, _ session) {
	var in struct {
		PoolID        int64  `json:"pool_id"`
		ProviderKeyID int64  `json:"provider_key_id"`
		Protocol      string `json:"protocol"`
		BaseURL       string `json:"base_url"`
		Status        string `json:"status"`
		Priority      int    `json:"priority"`
		Weight        int    `json:"weight"`
	}
	if err := readJSON(r, &in); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	id, err := a.Cat.CreateChannel(r.Context(), in.PoolID, in.ProviderKeyID, in.Protocol, in.BaseURL, in.Status, in.Priority, in.Weight)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, map[string]any{"id": id})
}

func (a *API) updateChannel(w http.ResponseWriter, r *http.Request, _ session) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var in struct {
		Status   string `json:"status"`
		Priority int    `json:"priority"`
		Weight   int    `json:"weight"`
	}
	if err := readJSON(r, &in); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	if err := a.Cat.UpdateChannel(r.Context(), id, in.Status, in.Priority, in.Weight); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, true)
}

func (a *API) listVKs(w http.ResponseWriter, r *http.Request, _ session) {
	rows, err := a.Cat.ListVKs(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, rows)
}

func (a *API) createVK(w http.ResponseWriter, r *http.Request, _ session) {
	var in struct {
		Name              string `json:"name"`
		ModelScope        string `json:"model_scope"`
		IPWhitelist       string `json:"ip_whitelist"`
		PoolID            int64  `json:"pool_id"`
		RPMLimit          int    `json:"rpm_limit"`
		MonthlyTokenLimit int64  `json:"monthly_token_limit"`
	}
	if err := readJSON(r, &in); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	id, raw, err := a.Cat.CreateVK(r.Context(), in.Name, in.PoolID, 0, in.RPMLimit, in.MonthlyTokenLimit, in.ModelScope, in.IPWhitelist)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, map[string]any{"id": id, "virtual_key": raw})
}

func (a *API) revokeVK(w http.ResponseWriter, r *http.Request, _ session) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := a.Cat.RevokeVK(r.Context(), id); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, true)
}

func (a *API) listApps(w http.ResponseWriter, r *http.Request, _ session) {
	rows, err := a.Cat.ListApplications(r.Context(), 0)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, rows)
}

func (a *API) approveApp(w http.ResponseWriter, r *http.Request, _ session) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	raw, err := a.Cat.ApproveApplication(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, map[string]any{"virtual_key": raw})
}

func (a *API) createApp(w http.ResponseWriter, r *http.Request, ss session) {
	var in struct {
		PoolID int64  `json:"pool_id"`
		Name   string `json:"name"`
	}
	if err := readJSON(r, &in); err != nil || in.PoolID == 0 {
		http.Error(w, "bad json", 400)
		return
	}
	id, err := a.Cat.CreateApplication(r.Context(), ss.OperatorID, in.PoolID, in.Name)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, map[string]any{"id": id})
}

func (a *API) myApps(w http.ResponseWriter, r *http.Request, ss session) {
	rows, err := a.Cat.ListApplications(r.Context(), ss.OperatorID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeOK(w, rows)
}

func (a *API) revealApp(w http.ResponseWriter, r *http.Request, ss session) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	raw, err := a.Cat.TakeApplicationKey(r.Context(), id, ss.OperatorID)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	writeOK(w, map[string]any{"virtual_key": raw})
}
