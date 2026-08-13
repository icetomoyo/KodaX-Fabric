package hub_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"kodax-fabric/internal/hub"
	"kodax-fabric/internal/store"
)

func TestAdminCRUDChainBothEndpoints(t *testing.T) {
	var chatHits, msgHits int32
	chatUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chatHits++
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer mock-") {
			t.Errorf("provider auth")
		}
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(chatUp.Close)
	msgUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		msgHits++
		if r.Header.Get("X-Api-Key") == "" {
			t.Errorf("anth auth")
		}
		_, _ = w.Write([]byte(`{"usage":{"input_tokens":1,"output_tokens":1},"content":[{"text":"ok"}]}`))
	}))
	t.Cleanup(msgUp.Close)

	st := &store.Memory{}
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	srv, gw := v8srv(t, st, clk)
	_ = srv
	admin := func(method, path, body string) *http.Response {
		req, _ := http.NewRequest(method, gw.URL+path, strings.NewReader(body))
		req.Header.Set("X-Admin-Token", "adm-secret")
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	resp := admin("POST", "/admin/v1/providers", `{"provider_code":"mock-o","secret":"mock-openai"}`)
	var po store.ProviderKeyView
	_ = json.NewDecoder(resp.Body).Decode(&po)
	_ = resp.Body.Close()
	if resp.StatusCode != 201 || po.ID == 0 {
		t.Fatalf("prov o %d %+v", resp.StatusCode, po)
	}
	resp = admin("POST", "/admin/v1/providers", `{"provider_code":"mock-a","secret":"mock-anthropic"}`)
	var pa store.ProviderKeyView
	_ = json.NewDecoder(resp.Body).Decode(&pa)
	_ = resp.Body.Close()
	resp = admin("POST", "/admin/v1/pools", `{"name":"p1","group_name":"standard"}`)
	var pool store.ChannelPool
	_ = json.NewDecoder(resp.Body).Decode(&pool)
	_ = resp.Body.Close()
	resp = admin("POST", "/admin/v1/channels", `{"pool_id":`+itoa64(pool.ID)+`,"provider_key_id":`+itoa64(po.ID)+`,"protocol":"openai_chat","base_url":"`+chatUp.URL+`"}`)
	if resp.StatusCode != 201 {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("ch o %d %s", resp.StatusCode, raw)
	}
	_ = resp.Body.Close()
	resp = admin("POST", "/admin/v1/channels", `{"pool_id":`+itoa64(pool.ID)+`,"provider_key_id":`+itoa64(pa.ID)+`,"protocol":"anthropic_messages","base_url":"`+msgUp.URL+`"}`)
	if resp.StatusCode != 201 {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("ch a %d %s", resp.StatusCode, raw)
	}
	_ = resp.Body.Close()
	resp = admin("POST", "/admin/v1/virtual-keys", `{"pool_id":`+itoa64(pool.ID)+`}`)
	var created struct {
		Plaintext string `json:"plaintext"`
	}
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 201 {
		t.Fatalf("vk %d %s", resp.StatusCode, raw)
	}
	if strings.Contains(string(raw), "mock-openai") || strings.Contains(string(raw), "mock-anthropic") {
		t.Fatalf("secret leaked %s", raw)
	}
	_ = json.Unmarshal(raw, &created)
	if !strings.HasPrefix(created.Plaintext, "fab-") {
		t.Fatalf("plaintext %s", created.Plaintext)
	}
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+created.Plaintext)
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 200 {
		t.Fatalf("chat %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(`{"model":"claude"}`))
	req.Header.Set("X-Api-Key", created.Plaintext)
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 200 {
		t.Fatalf("msg %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	if chatHits != 1 || msgHits != 1 {
		t.Fatalf("hits %d %d", chatHits, msgHits)
	}
}

func TestAdminPartialUpdateRetainAndClear(t *testing.T) {
	const secret = "sk-admin-must-not-leak"
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{}
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, gw := v8srv(t, st, clk)
	admin := func(method, path, body string) (int, []byte) {
		t.Helper()
		req, _ := http.NewRequest(method, gw.URL+path, strings.NewReader(body))
		req.Header.Set("X-Admin-Token", "adm-secret")
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if strings.Contains(string(raw), secret) {
			t.Fatalf("secret leaked %s %s %s", method, path, raw)
		}
		return resp.StatusCode, raw
	}

	code, raw := admin("POST", "/admin/v1/providers", `{"provider_code":"mock-o","secret":"`+secret+`","rpm_limit":60,"rpm_burst":10}`)
	var po store.ProviderKeyView
	if err := json.Unmarshal(raw, &po); err != nil || code != 201 {
		t.Fatalf("prov %d %s", code, raw)
	}
	if po.RPMLimit != 60 || po.RPMBurst != 10 || po.TeamID != 0 {
		t.Fatalf("create view %+v", po)
	}
	code, raw = admin("PATCH", "/admin/v1/providers/"+itoa64(po.ID), `{"status":"active"}`)
	if err := json.Unmarshal(raw, &po); err != nil || code != 200 {
		t.Fatalf("prov status-only %d %s", code, raw)
	}
	if po.RPMLimit != 60 || po.RPMBurst != 10 || po.Status != "active" {
		t.Fatalf("status-only lost fields %+v", po)
	}
	code, raw = admin("PATCH", "/admin/v1/providers/"+itoa64(po.ID), `{"rpm_limit":0,"rpm_burst":0,"team_id":0}`)
	if err := json.Unmarshal(raw, &po); err != nil || code != 200 {
		t.Fatalf("prov clear %d %s", code, raw)
	}
	if po.RPMLimit != 0 || po.RPMBurst != 0 {
		t.Fatalf("explicit clear %+v", po)
	}

	code, raw = admin("POST", "/admin/v1/pools", `{"name":"p1","group_name":"premium"}`)
	var pool store.ChannelPool
	if err := json.Unmarshal(raw, &pool); err != nil || code != 201 {
		t.Fatalf("pool %d %s", code, raw)
	}
	code, raw = admin("PATCH", "/admin/v1/pools/"+itoa64(pool.ID), `{"name":"p1-renamed"}`)
	if err := json.Unmarshal(raw, &pool); err != nil || code != 200 {
		t.Fatalf("pool name-only %d %s", code, raw)
	}
	if pool.Name != "p1-renamed" || pool.GroupName != "premium" {
		t.Fatalf("pool retain %+v", pool)
	}
	code, raw = admin("PATCH", "/admin/v1/pools/"+itoa64(pool.ID), `{"team_id":0}`)
	if err := json.Unmarshal(raw, &pool); err != nil || code != 200 || pool.GroupName != "premium" {
		t.Fatalf("pool team clear %d %s", code, raw)
	}

	code, raw = admin("POST", "/admin/v1/channels", `{"pool_id":`+itoa64(pool.ID)+`,"provider_key_id":`+itoa64(po.ID)+`,"protocol":"openai_chat","base_url":"`+up.URL+`","weight":50,"priority":1,"models":["gpt-4"]}`)
	var ch store.ChannelAdmin
	if err := json.Unmarshal(raw, &ch); err != nil || code != 201 {
		t.Fatalf("ch %d %s", code, raw)
	}
	code, raw = admin("PATCH", "/admin/v1/channels/"+itoa64(ch.ID), `{"status":"active"}`)
	if err := json.Unmarshal(raw, &ch); err != nil || code != 200 {
		t.Fatalf("ch status-only %d %s", code, raw)
	}
	if ch.Weight != 50 || ch.Priority != 1 || len(ch.Models) != 1 || ch.Models[0] != "gpt-4" || ch.BaseURL != up.URL {
		t.Fatalf("ch retain %+v", ch)
	}
	code, raw = admin("PATCH", "/admin/v1/channels/"+itoa64(ch.ID), `{"models":[],"weight":0}`)
	if err := json.Unmarshal(raw, &ch); err != nil || code != 200 {
		t.Fatalf("ch clear %d %s", code, raw)
	}
	if len(ch.Models) != 0 || ch.Weight != 0 || ch.Priority != 1 {
		t.Fatalf("ch explicit clear %+v", ch)
	}

	code, raw = admin("POST", "/admin/v1/virtual-keys", `{"pool_id":`+itoa64(pool.ID)+`,"rpm_limit":30,"rpm_burst":5,"monthly_hard":100,"monthly_soft":80,"model_scope":["gpt-4"],"ip_allow":["127.0.0.1"]}`)
	var created struct {
		VirtualKey store.VirtualKeyAdmin `json:"virtual_key"`
		Plaintext  string                `json:"plaintext"`
	}
	if err := json.Unmarshal(raw, &created); err != nil || code != 201 {
		t.Fatalf("vk %d %s", code, raw)
	}
	vk := created.VirtualKey
	code, raw = admin("PATCH", "/admin/v1/virtual-keys/"+itoa64(vk.ID), `{"status":"active"}`)
	if err := json.Unmarshal(raw, &vk); err != nil || code != 200 {
		t.Fatalf("vk status-only %d %s", code, raw)
	}
	if vk.RPMLimit != 30 || vk.RPMBurst != 5 || vk.MonthlyHard != 100 || vk.MonthlySoft != 80 ||
		len(vk.ModelScope) != 1 || vk.ModelScope[0] != "gpt-4" || len(vk.IPAllow) != 1 {
		t.Fatalf("vk retain %+v", vk)
	}
	code, raw = admin("PATCH", "/admin/v1/virtual-keys/"+itoa64(vk.ID), `{"rpm_limit":0,"rpm_burst":0,"monthly_hard":0,"monthly_soft":0,"model_scope":[],"ip_allow":[]}`)
	if err := json.Unmarshal(raw, &vk); err != nil || code != 200 {
		t.Fatalf("vk clear %d %s", code, raw)
	}
	if vk.RPMLimit != 0 || vk.MonthlyHard != 0 || len(vk.ModelScope) != 0 || len(vk.IPAllow) != 0 || vk.Status != "active" {
		t.Fatalf("vk explicit clear %+v", vk)
	}

	code, raw = admin("GET", "/admin/v1/providers", "")
	if code != 200 || strings.Contains(string(raw), secret) || strings.Contains(string(raw), `"secret"`) {
		t.Fatalf("list providers leaked %d %s", code, raw)
	}
	var listed struct {
		Providers []store.ProviderKeyView `json:"providers"`
	}
	if err := json.Unmarshal(raw, &listed); err != nil || len(listed.Providers) == 0 {
		t.Fatalf("list providers %s", raw)
	}
	found := false
	for _, p := range listed.Providers {
		if p.ID == po.ID {
			found = true
			if p.RPMLimit != 0 || p.TeamID != 0 || p.ProviderCode != "mock-o" {
				t.Fatalf("list view %+v", p)
			}
		}
	}
	if !found {
		t.Fatalf("provider missing from list %s", raw)
	}
	code, raw = admin("GET", "/admin/v1/channels", "")
	if code != 200 || strings.Contains(string(raw), secret) {
		t.Fatalf("list channels leaked %d %s", code, raw)
	}
	code, raw = admin("GET", "/admin/v1/virtual-keys", "")
	if code != 200 || strings.Contains(string(raw), secret) || strings.Contains(string(raw), created.Plaintext) {
		t.Fatalf("list vks leaked %d %s", code, raw)
	}

	resolved, err := st.ResolveVK(nil, created.Plaintext)
	if err != nil || resolved == nil || len(resolved.Channels) == 0 {
		t.Fatalf("runtime vk %+v %v", resolved, err)
	}
	if resolved.RPMLimit != 0 || len(resolved.ModelScope) != 0 {
		t.Fatalf("runtime vk not synced %+v", resolved)
	}
	if resolved.Channels[0].Weight != 0 || len(resolved.Channels[0].Models) != 0 {
		t.Fatalf("runtime channel not synced %+v", resolved.Channels[0])
	}

	code, _ = admin("PATCH", "/admin/v1/providers/"+itoa64(po.ID), `{"rpm_limit":-1}`)
	if code != 400 {
		t.Fatalf("neg rpm %d", code)
	}
	code, _ = admin("PATCH", "/admin/v1/providers/"+itoa64(po.ID), `{"status":"weird"}`)
	if code != 400 {
		t.Fatalf("bad status %d", code)
	}
	code, _ = admin("POST", "/admin/v1/channels", `{"pool_id":`+itoa64(pool.ID)+`,"provider_key_id":`+itoa64(po.ID)+`,"protocol":"nope","base_url":"`+up.URL+`"}`)
	if code != 400 {
		t.Fatalf("bad protocol %d", code)
	}
	code, _ = admin("PATCH", "/admin/v1/channels/"+itoa64(ch.ID), `{"weight":-1}`)
	if code != 400 {
		t.Fatalf("bad weight %d", code)
	}

	st.Teams = map[int64]struct{}{1: {}, 2: {}}
	code, raw = admin("POST", "/admin/v1/providers", `{"provider_code":"t2","secret":"`+secret+`","team_id":2}`)
	var p2 store.ProviderKeyView
	if err := json.Unmarshal(raw, &p2); err != nil || code != 201 {
		t.Fatalf("prov team2 %d %s", code, raw)
	}
	code, _ = admin("POST", "/admin/v1/channels", `{"pool_id":`+itoa64(pool.ID)+`,"provider_key_id":`+itoa64(p2.ID)+`,"protocol":"openai_chat","base_url":"`+up.URL+`"}`)
	if code != 400 {
		t.Fatalf("team mismatch %d", code)
	}
}

func TestAdminPatchChannelRuntimeSync(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{}
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, gw := v8srv(t, st, clk)
	admin := func(method, path, body string) (int, []byte) {
		t.Helper()
		req, _ := http.NewRequest(method, gw.URL+path, strings.NewReader(body))
		req.Header.Set("X-Admin-Token", "adm-secret")
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		return resp.StatusCode, raw
	}
	_, raw := admin("POST", "/admin/v1/providers", `{"provider_code":"mock-o","secret":"mock-openai"}`)
	var po store.ProviderKeyView
	_ = json.Unmarshal(raw, &po)
	_, raw = admin("POST", "/admin/v1/pools", `{"name":"p1"}`)
	var pool store.ChannelPool
	_ = json.Unmarshal(raw, &pool)
	_, raw = admin("POST", "/admin/v1/channels", `{"pool_id":`+itoa64(pool.ID)+`,"provider_key_id":`+itoa64(po.ID)+`,"protocol":"openai_chat","base_url":"`+up.URL+`"}`)
	var ch store.ChannelAdmin
	_ = json.Unmarshal(raw, &ch)
	_, raw = admin("POST", "/admin/v1/virtual-keys", `{"pool_id":`+itoa64(pool.ID)+`}`)
	var created struct {
		Plaintext string `json:"plaintext"`
	}
	_ = json.Unmarshal(raw, &created)
	call := func() int {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer "+created.Plaintext)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	if call() != 200 {
		t.Fatal("before disable")
	}
	code, _ := admin("PATCH", "/admin/v1/channels/"+itoa64(ch.ID), `{"status":"disabled"}`)
	if code != 200 {
		t.Fatalf("disable %d", code)
	}
	if call() == 200 {
		t.Fatal("disabled channel still routed")
	}
	code, _ = admin("PATCH", "/admin/v1/channels/"+itoa64(ch.ID), `{"status":"active"}`)
	if code != 200 || call() != 200 {
		t.Fatal("re-enable")
	}
}
