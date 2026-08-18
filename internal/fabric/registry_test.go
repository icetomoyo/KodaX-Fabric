package fabric_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestAdminRegisterProviderHidesKey(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	created := createProvider(t, admin, srv.URL, "ds", "openai", "https://api.deepseek.com", "sk-secret-never-store-plain")
	if created.Name != "ds" || created.Family != "openai" {
		t.Fatalf("created %+v", created)
	}
	if strings.Contains(created.raw, "sk-secret") {
		t.Fatalf("plaintext key in create response: %s", created.raw)
	}

	resp, err := admin.Get(srv.URL + "/admin/api/providers")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(body), "sk-secret") {
		t.Fatalf("plaintext in list: %s", body)
	}

	one, err := admin.Get(srv.URL + "/admin/api/providers/ds")
	if err != nil {
		t.Fatal(err)
	}
	defer one.Body.Close()
	got, _ := io.ReadAll(one.Body)
	if strings.Contains(string(got), "sk-secret") {
		t.Fatalf("plaintext in get: %s", got)
	}
}

func TestAdminRegisterModelAndPassthrough(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	createProvider(t, admin, srv.URL, "ds", "openai", "https://example.invalid", "sk-x")
	createModel(t, admin, srv.URL, "my-flash", "openai", "ds")
	putPrice(t, admin, srv.URL, "my-flash", 1, 2, 0.1)

	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"my-flash","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	rows := listRequestCosts(t, admin, srv.URL)
	if len(rows) != 1 {
		t.Fatalf("requests %+v", rows)
	}
}

func TestModelNameIsUniqueNoDualKey(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	createProvider(t, admin, srv.URL, "a", "openai", "https://a.example", "sk-a")
	createProvider(t, admin, srv.URL, "b", "openai", "https://b.example", "sk-b")
	createModel(t, admin, srv.URL, "same", "openai", "a")
	status := createModelStatus(t, admin, srv.URL, "same", "openai", "b")
	if status != http.StatusConflict {
		t.Fatalf("second mapping %d", status)
	}
}

func TestDisableModelRejectsCalls(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	createProvider(t, admin, srv.URL, "ds", "openai", "https://example.invalid", "sk-x")
	createModel(t, admin, srv.URL, "my-flash", "openai", "ds")
	putPrice(t, admin, srv.URL, "my-flash", 1, 2, 0.1)
	if st := disableModel(t, admin, srv.URL, "my-flash"); st != http.StatusOK {
		t.Fatalf("disable model %d", st)
	}
	calls := srv.ProviderCalls()
	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"my-flash","messages":[]}`)
	if status != http.StatusBadRequest {
		t.Fatalf("status %d", status)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("disabled model hit provider")
	}
}

func TestDisableProviderRejectsCalls(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	createProvider(t, admin, srv.URL, "ds", "openai", "https://example.invalid", "sk-x")
	createModel(t, admin, srv.URL, "my-flash", "openai", "ds")
	putPrice(t, admin, srv.URL, "my-flash", 1, 2, 0.1)
	if st := disableProvider(t, admin, srv.URL, "ds"); st != http.StatusOK {
		t.Fatalf("disable provider %d", st)
	}
	calls := srv.ProviderCalls()
	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"my-flash","messages":[]}`)
	if status != http.StatusBadRequest {
		t.Fatalf("status %d", status)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("disabled provider hit upstream")
	}
}

func TestRegistryDrivesLiveUpstream(t *testing.T) {
	var gotAuth, gotPath string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"live","usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	t.Cleanup(up.Close)

	srv := newTestServer(t)
	srv.app.UseRegistry = true
	admin := loginAdmin(t, srv)
	createProvider(t, admin, srv.URL, "live-ds", "openai", up.URL, "sk-from-registry")
	createModel(t, admin, srv.URL, "reg-model", "openai", "live-ds")
	putPrice(t, admin, srv.URL, "reg-model", 1, 2, 0.1)

	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"reg-model","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	if gotAuth != "Bearer sk-from-registry" {
		t.Fatalf("auth %q", gotAuth)
	}
	if gotPath != "/chat/completions" {
		t.Fatalf("path %s", gotPath)
	}
}

func TestRegisterAnthropicProvider(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	p := createProvider(t, admin, srv.URL, "claude", "anthropic", "https://api.anthropic.com", "sk-ant-secret")
	if p.Family != "anthropic" {
		t.Fatalf("%+v", p)
	}
	if strings.Contains(p.raw, "sk-ant-secret") {
		t.Fatal("anthropic key leaked")
	}
	createModel(t, admin, srv.URL, "my-claude", "anthropic", "claude")
	putPrice(t, admin, srv.URL, "my-claude", 1, 2, 0.1)
	status, _ := postMessages(t, srv, fabric.SeedVirtualKey, `{"model":"my-claude","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("messages %d", status)
	}
}

type providerView struct {
	Name    string `json:"name"`
	Family  string `json:"family"`
	BaseURL string `json:"base_url"`
	raw     string
}

func createProvider(t *testing.T, admin *http.Client, base, name, family, url, key string) providerView {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"name": name, "family": family, "base_url": url, "api_key": key})
	resp, err := admin.Post(base+"/admin/api/providers", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("create provider %d: %s", resp.StatusCode, raw)
	}
	var out providerView
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	out.raw = string(raw)
	return out
}

func createModel(t *testing.T, admin *http.Client, base, name, family, provider string) {
	t.Helper()
	st := createModelStatus(t, admin, base, name, family, provider)
	if st != http.StatusCreated && st != http.StatusOK {
		t.Fatalf("create model %d", st)
	}
}

func createModelStatus(t *testing.T, admin *http.Client, base, name, family, provider string) int {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"name": name, "family": family, "provider": provider})
	resp, err := admin.Post(base+"/admin/api/models", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func disableModel(t *testing.T, admin *http.Client, base, name string) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, base+"/admin/api/models/"+name+"/disable", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := admin.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func disableProvider(t *testing.T, admin *http.Client, base, name string) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, base+"/admin/api/providers/"+name+"/disable", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := admin.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}
