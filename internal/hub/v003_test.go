package hub_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"kodax-fabric/internal/hub"
	"kodax-fabric/internal/store"
)

func gatewayWithVK(t *testing.T, vk *store.ResolvedVK, now func() time.Time) *httptest.Server {
	t.Helper()
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{testVK: vk}}
	s := hub.New(st, http.DefaultClient)
	if now != nil {
		s.Now = now
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts
}

func TestExpiredVK401BothEndpointsZeroUpstream(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(up.Close)

	exp := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) // exactly expired
	vk := &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1,
		ExpiresAt: &exp,
		Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-oai"},
			{ID: 2, Protocol: store.ProtocolAnthropic, BaseURL: up.URL, Secret: "sk-anth"},
		},
	}
	gw := gatewayWithVK(t, vk, func() time.Time { return now })

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("chat status %d body %s", resp.StatusCode, raw)
	}
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatal(err)
	}
	if env.Error.Code != "invalid_api_key" {
		t.Fatalf("openai envelope %+v %s", env, raw)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(`{"model":"claude"}`))
	req.Header.Set("X-Api-Key", testVK)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("messages status %d body %s", resp.StatusCode, raw)
	}
	if !strings.Contains(string(raw), "invalid virtual key") {
		t.Fatalf("anthropic envelope %s", raw)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("upstream hits %d", hits)
	}
}

func TestUnexpiredVKStillReachesUpstream(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	exp := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	vk := &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, ExpiresAt: &exp,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-oai"}},
	}
	gw := gatewayWithVK(t, vk, func() time.Time { return now })
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
}

func TestModelNotInScope403ZeroUpstream(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	vk := &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, ModelScope: []string{"gpt-4"},
		Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-oai"},
			{ID: 2, Protocol: store.ProtocolAnthropic, BaseURL: up.URL, Secret: "sk-anth"},
		},
	}
	gw := gatewayWithVK(t, vk, nil)

	for _, body := range []string{
		`{"model":"gpt-3.5","messages":[{"role":"user","content":"x"}]}`,
		`{"messages":[{"role":"user","content":"x"}]}`,
		`{"model":"","messages":[{"role":"user","content":"x"}]}`,
	} {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != 403 {
			t.Fatalf("body %s status %d %s", body, resp.StatusCode, raw)
		}
		if !strings.Contains(string(raw), "model_not_allowed") && !strings.Contains(string(raw), "model not allowed") {
			t.Fatalf("envelope %s", raw)
		}
	}
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(`{"model":"claude-opus"}`))
	req.Header.Set("X-Api-Key", testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("messages status %d %s", resp.StatusCode, raw)
	}
	if !strings.Contains(string(raw), "model not allowed") {
		t.Fatalf("anthropic envelope %s", raw)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("upstream hits %d", hits)
	}
}

func TestModelInScopeAndEmptyScopeReachUpstream(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)

	scoped := &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, ModelScope: []string{"gpt-4"},
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-oai"}},
	}
	gw := gatewayWithVK(t, scoped, nil)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("in-scope status %d", resp.StatusCode)
	}

	open := &store.ResolvedVK{
		VirtualKeyID: 2, PoolID: 1,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-oai"}},
	}
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{"fab-open": open}}
	s := hub.New(st, http.DefaultClient)
	openGW := httptest.NewServer(s.Handler())
	t.Cleanup(openGW.Close)
	req, _ = http.NewRequest(http.MethodPost, openGW.URL+"/v1/chat/completions", strings.NewReader(`{"model":"whatever"}`))
	req.Header.Set("Authorization", "Bearer fab-open")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("empty-scope status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("hits %d", hits)
	}
}

func TestModelRejectDoesNotAdvanceRotation(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	vk := &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, ModelScope: []string{"gpt-4"},
		Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-a"},
			{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-b"},
		},
	}
	gw := gatewayWithVK(t, vk, nil)

	deny, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-3.5"}`))
	deny.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(deny)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("deny status %d", resp.StatusCode)
	}

	ok, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	ok.Header.Set("Authorization", "Bearer "+testVK)
	resp, err = http.DefaultClient.Do(ok)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("allow status %d", resp.StatusCode)
	}
	if len(got) != 1 || got[0] != "sk-key-a" {
		t.Fatalf("rotation after deny should still start at A: %v", got)
	}
}
