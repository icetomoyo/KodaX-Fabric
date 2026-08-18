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

func TestSuperAdminCreatesTwoKeysAndTwoChannelsForSameModel(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	createProvider(t, admin, srv.URL, "ds", "openai", "https://api.deepseek.com", "sk-one")
	k1 := listProviderKeys(t, admin, srv.URL, "ds")
	if len(k1) != 1 {
		t.Fatalf("first key %+v", k1)
	}
	k2 := createProviderKey(t, admin, srv.URL, "ds", "sk-two")
	if k2.ID == "" || k2.ID == k1[0].ID {
		t.Fatalf("second key %+v vs %+v", k2, k1)
	}
	if strings.Contains(k2.raw, "sk-two") || strings.Contains(k2.raw, "sk-one") {
		t.Fatalf("plaintext in key create: %s", k2.raw)
	}

	createModel(t, admin, srv.URL, "pool-model", "openai", "ds")
	c1 := createChannel(t, admin, srv.URL, "pool-model", k1[0].ID, 1, 10, 1, 2, 0.1)
	c2 := createChannel(t, admin, srv.URL, "pool-model", k2.ID, 1, 5, 1, 2, 0.1)
	if c1.ID == c2.ID {
		t.Fatalf("channel ids %+v %+v", c1, c2)
	}

	listed := listChannels(t, admin, srv.URL, "pool-model")
	if len(listed) != 2 {
		t.Fatalf("channels %+v", listed)
	}

	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"pool-model","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("call pool %d", status)
	}
}

func TestUnpricedChannelIsNotSelectedAndEmptyPoolRejects(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	createProvider(t, admin, srv.URL, "ds", "openai", "https://example.invalid", "sk-one")
	keys := listProviderKeys(t, admin, srv.URL, "ds")
	k2 := createProviderKey(t, admin, srv.URL, "ds", "sk-two")
	createModel(t, admin, srv.URL, "pool-model", "openai", "ds")
	createChannelNoPrice(t, admin, srv.URL, "pool-model", keys[0].ID)
	createChannel(t, admin, srv.URL, "pool-model", k2.ID, 1, 1, 1, 2, 0.1)

	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"pool-model","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("priced channel should serve %d", status)
	}

	var pricedID string
	for _, ch := range listChannels(t, admin, srv.URL, "pool-model") {
		if ch.InputCNY != 0 {
			pricedID = ch.ID
		}
	}
	if st := disableChannel(t, admin, srv.URL, pricedID); st != http.StatusOK {
		t.Fatalf("disable priced %d", st)
	}
	calls := srv.ProviderCalls()
	status, _ = postChat(t, srv, fabric.SeedVirtualKey, `{"model":"pool-model","messages":[]}`)
	if status != http.StatusBadRequest {
		t.Fatalf("empty pool %d", status)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("empty pool called provider")
	}
}

func TestDuplicateModelAndProviderKeyIsConflict(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	createProvider(t, admin, srv.URL, "ds", "openai", "https://example.invalid", "sk-one")
	keys := listProviderKeys(t, admin, srv.URL, "ds")
	createModel(t, admin, srv.URL, "pool-model", "openai", "ds")
	createChannel(t, admin, srv.URL, "pool-model", keys[0].ID, 1, 1, 1, 2, 0.1)
	body, _ := json.Marshal(map[string]any{
		"model": "pool-model", "provider_key": keys[0].ID,
		"weight": 1, "priority": 1, "input_cny": 1, "output_cny": 2, "cached_cny": 0.1,
	})
	resp, err := admin.Post(srv.URL+"/admin/api/channels", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("dup channel %d", resp.StatusCode)
	}
}

func TestEnterpriseAdminCannotSeeProviderKeyPlaintext(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	createProvider(t, admin, srv.URL, "ds", "openai", "https://example.invalid", "sk-secret-plain")
	boss := newEnterpriseAdmin(t, srv, "acme", "acme-boss")

	devUser := mustCreateUser(t, boss, srv.URL, map[string]string{
		"username": "acme-dev", "password": "dev-pass", "role": "developer",
	})
	_ = devUser
	mustCreateProject(t, boss, srv.URL, "billing")
	mustAddMember(t, boss, srv.URL, "billing", "acme-dev")
	dev := loginUser(t, srv, "acme-dev", "dev-pass")

	assertForbidden(t, boss, http.MethodGet, srv.URL+"/admin/api/providers/ds/keys", "")
	assertForbidden(t, boss, http.MethodPost, srv.URL+"/admin/api/providers/ds/keys", `{"api_key":"sk-x"}`)
	assertForbidden(t, boss, http.MethodGet, srv.URL+"/admin/api/channels", "")
	assertForbidden(t, boss, http.MethodPost, srv.URL+"/admin/api/channels", `{"model":"gpt-4o-mini","provider_key":"pk-x"}`)
	lead := mustCreateUser(t, boss, srv.URL, map[string]string{
		"username": "acme-lead", "password": "lead-pass", "role": "team_admin",
	})
	_ = lead
	mustAddMember(t, boss, srv.URL, "billing", "acme-lead")
	teamAdmin := loginUser(t, srv, "acme-lead", "lead-pass")
	assertForbidden(t, dev, http.MethodGet, srv.URL+"/admin/api/providers/ds/keys", "")
	assertForbidden(t, dev, http.MethodGet, srv.URL+"/admin/api/channels", "")
	assertForbidden(t, teamAdmin, http.MethodGet, srv.URL+"/admin/api/providers/ds/keys", "")

	listed, err := admin.Get(srv.URL + "/admin/api/providers/ds/keys")
	if err != nil {
		t.Fatal(err)
	}
	defer listed.Body.Close()
	raw, _ := io.ReadAll(listed.Body)
	if strings.Contains(string(raw), "sk-secret-plain") {
		t.Fatalf("plaintext in key list: %s", raw)
	}
}

func TestChannelPoolDrivesLiveUpstream(t *testing.T) {
	var gotAuth string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"live","usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	t.Cleanup(up.Close)

	srv := newTestServer(t)
	srv.app.UseRegistry = true
	admin := loginAdmin(t, srv)
	createProvider(t, admin, srv.URL, "live-ds", "openai", up.URL, "sk-on-provider")
	k2 := createProviderKey(t, admin, srv.URL, "live-ds", "sk-on-channel")
	createModel(t, admin, srv.URL, "pool-live", "openai", "live-ds")
	createChannel(t, admin, srv.URL, "pool-live", k2.ID, 1, 10, 1, 2, 0.1)

	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"pool-live","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	if gotAuth != "Bearer sk-on-channel" {
		t.Fatalf("auth %q", gotAuth)
	}
}

type providerKeyView struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Disabled bool   `json:"disabled"`
	raw      string
}

type channelView struct {
	ID          string  `json:"id"`
	Model       string  `json:"model"`
	ProviderKey string  `json:"provider_key"`
	Weight      int     `json:"weight"`
	Priority    int     `json:"priority"`
	InputCNY    float64 `json:"input_cny"`
	OutputCNY   float64 `json:"output_cny"`
	CachedCNY   float64 `json:"cached_cny"`
}

func createProviderKey(t *testing.T, admin *http.Client, base, provider, apiKey string) providerKeyView {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"api_key": apiKey})
	resp, err := admin.Post(base+"/admin/api/providers/"+provider+"/keys", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create key %d: %s", resp.StatusCode, raw)
	}
	var out providerKeyView
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	out.raw = string(raw)
	return out
}

func listProviderKeys(t *testing.T, admin *http.Client, base, provider string) []providerKeyView {
	t.Helper()
	resp, err := admin.Get(base + "/admin/api/providers/" + provider + "/keys")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list keys %d: %s", resp.StatusCode, raw)
	}
	var payload struct {
		Keys []providerKeyView `json:"keys"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Keys
}

func createChannel(t *testing.T, admin *http.Client, base, model, keyID string, weight, priority int, in, outCNY, cached float64) channelView {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"model":        model,
		"provider_key": keyID,
		"weight":       weight,
		"priority":     priority,
		"input_cny":    in,
		"output_cny":   outCNY,
		"cached_cny":   cached,
	})
	resp, err := admin.Post(base+"/admin/api/channels", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create channel %d: %s", resp.StatusCode, raw)
	}
	var out channelView
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func listChannels(t *testing.T, admin *http.Client, base, model string) []channelView {
	t.Helper()
	resp, err := admin.Get(base + "/admin/api/channels?model=" + model)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list channels %d: %s", resp.StatusCode, raw)
	}
	var payload struct {
		Channels []channelView `json:"channels"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Channels
}

func createChannelNoPrice(t *testing.T, admin *http.Client, base, model, keyID string) channelView {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"model": model, "provider_key": keyID, "weight": 1, "priority": 1,
	})
	resp, err := admin.Post(base+"/admin/api/channels", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create channel no price %d: %s", resp.StatusCode, raw)
	}
	var out channelView
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func disableChannel(t *testing.T, admin *http.Client, base, id string) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, base+"/admin/api/channels/"+id+"/disable", nil)
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
