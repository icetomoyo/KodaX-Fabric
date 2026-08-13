package hub_test

import (
	"context"
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

func v8srv(t *testing.T, st *store.Memory, clk *hub.FakeClock) (*hub.Server, *httptest.Server) {
	t.Helper()
	srv := hub.New(st, http.DefaultClient)
	if clk != nil {
		srv.Clock = clk
		srv.Budget = hub.NewMemoryBudget(clk)
		srv.Limits = hub.NewLimiter(clk)
		srv.Cache = hub.NewMemoryCache(clk, time.Hour)
	}
	srv.AdminToken = "adm-secret"
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	return srv, gw
}

func cacheableChat() string {
	return `{"model":"gpt-4","messages":[{"role":"user","content":"hi"}],"fabric_context":{"preferences":{"cacheable":true}}}`
}

func TestIPAllowAndReject(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	ch := store.Channel{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, IPAllow: []string{"127.0.0.1", "127.0.0.0/8"}, Channels: []store.Channel{ch}},
	}}
	_, gw := v8srv(t, st, clk)
	resp := doChat(t, gw, `{"model":"gpt-4"}`)
	if resp.StatusCode != 200 {
		t.Fatalf("allow %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	st.ByRawKey[testVK].IPAllow = []string{"10.0.0.1"}
	resp = doChat(t, gw, `{"model":"gpt-4"}`)
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden || !strings.Contains(string(raw), "ip_not_allowed") {
		t.Fatalf("deny %d %s", resp.StatusCode, raw)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
}

func TestIPSpoofedForwardedForIgnored(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, IPAllow: []string{"10.9.9.9"}, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	req.Header.Set("X-Forwarded-For", "10.9.9.9")
	req.Header.Set("X-Real-Ip", "10.9.9.9")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("hits %d", hits)
	}
}

func TestIPInvalidConfigFailClosed(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, IPAllow: []string{"not-a-cidr"}, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	resp := doChat(t, gw, `{"model":"gpt-4"}`)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden || atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("status %d hits %d", resp.StatusCode, hits)
	}
}

func TestIPValidThenInvalidFailClosed(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, IPAllow: []string{"127.0.0.1", "bad-rule"}, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	resp := doChat(t, gw, `{"model":"gpt-4"}`)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden || atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("status %d hits %d", resp.StatusCode, hits)
	}
}

type truncBody struct {
	data []byte
	off  int
}

func (b *truncBody) Read(p []byte) (int, error) {
	if b.off >= len(b.data) {
		return 0, io.ErrUnexpectedEOF
	}
	n := copy(p, b.data[b.off:])
	b.off += n
	if b.off >= len(b.data) {
		return n, io.ErrUnexpectedEOF
	}
	return n, nil
}

func (b *truncBody) Close() error { return nil }

type truncRT struct{ hits *int32 }

func (t *truncRT) RoundTrip(req *http.Request) (*http.Response, error) {
	atomic.AddInt32(t.hits, 1)
	return &http.Response{
		StatusCode: 200,
		Header:     http.Header{"Content-Type": {"application/json"}},
		Body:       &truncBody{data: []byte(`{"id":"partial","usage":{"total_tokens":4}`)},
		Request:    req,
	}, nil
}

func TestTruncatedSuccessNotCached(t *testing.T) {
	var hits int32
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: "http://upstream.test", Secret: "sk-up"},
		}},
	}}
	srv, gw := v8srv(t, st, clk)
	srv.Client = &http.Client{Transport: &truncRT{hits: &hits}}
	for i := 0; i < 2; i++ {
		resp := doChat(t, gw, cacheableChat())
		if resp.Header.Get("X-Fabric-Cache") != "MISS" {
			t.Fatalf("want MISS got %s", resp.Header.Get("X-Fabric-Cache"))
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
	if atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("hits %d", hits)
	}
	hr, _ := http.Get(gw.URL + "/health/cache")
	hb, _ := io.ReadAll(hr.Body)
	_ = hr.Body.Close()
	if !strings.Contains(string(hb), `"writes":0`) {
		t.Fatalf("writes %s", hb)
	}
}

func TestCacheHitStripsStaleHeaders(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("x-ratelimit-remaining-requests", "3")
		w.Header().Set("Retry-After", "9")
		_, _ = w.Write([]byte(usageBody(6)))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, MonthlyHard: 100, MonthlySoft: 10, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	resp := doChat(t, gw, cacheableChat())
	if resp.Header.Get("x-ratelimit-remaining-requests") != "3" || resp.Header.Get("X-Fabric-Budget-Used") == "" {
		t.Fatalf("first headers %v", resp.Header)
	}
	_ = resp.Body.Close()
	resp = doChat(t, gw, cacheableChat())
	defer resp.Body.Close()
	if resp.Header.Get("X-Fabric-Cache") != "HIT" {
		t.Fatalf("cache %s", resp.Header.Get("X-Fabric-Cache"))
	}
	if resp.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("ct %s", resp.Header.Get("Content-Type"))
	}
	if resp.Header.Get("x-ratelimit-remaining-requests") != "" || resp.Header.Get("Retry-After") != "" {
		t.Fatalf("stale ratelimit %v", resp.Header)
	}
	if resp.Header.Get("X-Fabric-Budget-Used") != "" || resp.Header.Get("X-Fabric-Channel-Id") != "" {
		t.Fatalf("stale fabric %v", resp.Header)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
}

func TestCacheTokensSavedFallsBackToEstimate(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"abcdefghijklmnopqrstuvwxyz012345"}}]}`))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	resp := doChat(t, gw, cacheableChat())
	_ = resp.Body.Close()
	resp = doChat(t, gw, cacheableChat())
	_ = resp.Body.Close()
	if resp.Header.Get("X-Fabric-Cache") != "HIT" {
		t.Fatalf("cache %s", resp.Header.Get("X-Fabric-Cache"))
	}
	hr, _ := http.Get(gw.URL + "/health/cache")
	hb, _ := io.ReadAll(hr.Body)
	_ = hr.Body.Close()
	var wrap struct {
		Cache struct {
			TokensSaved int64 `json:"tokens_saved"`
		} `json:"cache"`
	}
	if err := json.Unmarshal(hb, &wrap); err != nil || wrap.Cache.TokensSaved <= 0 {
		t.Fatalf("saved %s", hb)
	}
}

func TestResponseCacheHitZeroUpstream(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(usageBody(7)))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, ProjectID: 9, TeamID: 3, MonthlyHard: 1000, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up", PoolID: 1, TeamID: 3, KeyTeamID: 3},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	resp := doChat(t, gw, cacheableChat())
	if resp.StatusCode != 200 || resp.Header.Get("X-Fabric-Cache") != "MISS" {
		t.Fatalf("first %d %s", resp.StatusCode, resp.Header.Get("X-Fabric-Cache"))
	}
	_ = resp.Body.Close()
	resp = doChat(t, gw, cacheableChat())
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("X-Fabric-Cache") != "HIT" {
		t.Fatalf("second %d %s %s", resp.StatusCode, resp.Header.Get("X-Fabric-Cache"), raw)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
	hr, _ := http.Get(gw.URL + "/health/cache")
	hb, _ := io.ReadAll(hr.Body)
	_ = hr.Body.Close()
	if !strings.Contains(string(hb), `"hits":1`) || !strings.Contains(string(hb), `"writes":1`) {
		t.Fatalf("metrics %s", hb)
	}
	if budgetUsedOf(t, gw, 1) != 7 {
		t.Fatalf("hit must not consume extra budget %d", budgetUsedOf(t, gw, 1))
	}
}

func TestResponseCacheDefaultOff(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	for i := 0; i < 2; i++ {
		resp := doChat(t, gw, `{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`)
		if resp.Header.Get("X-Fabric-Cache") != "BYPASS" {
			t.Fatalf("want BYPASS got %s", resp.Header.Get("X-Fabric-Cache"))
		}
		_ = resp.Body.Close()
	}
	if atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("hits %d", hits)
	}
}

func TestResponseCacheTTL(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	srv, gw := v8srv(t, st, clk)
	srv.Cache = hub.NewMemoryCache(clk, time.Hour)
	resp := doChat(t, gw, cacheableChat())
	_ = resp.Body.Close()
	clk.Advance(2 * time.Hour)
	resp = doChat(t, gw, cacheableChat())
	_ = resp.Body.Close()
	if resp.Header.Get("X-Fabric-Cache") != "MISS" || atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("ttl cache=%s hits=%d", resp.Header.Get("X-Fabric-Cache"), hits)
	}
}

func TestResponseCacheScopeIsolation(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, TeamID: 1, ProjectID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-a", PoolID: 1, TeamID: 1, KeyTeamID: 1},
		}},
		"fab-b": {VirtualKeyID: 2, PoolID: 1, TeamID: 2, ProjectID: 2, Channels: []store.Channel{
			{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-b", PoolID: 1, TeamID: 2, KeyTeamID: 2},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	resp := doChat(t, gw, cacheableChat())
	_ = resp.Body.Close()
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(cacheableChat()))
	req.Header.Set("Authorization", "Bearer fab-b")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Header.Get("X-Fabric-Cache") != "MISS" {
		t.Fatalf("cross tenant %s", resp.Header.Get("X-Fabric-Cache"))
	}
	_ = resp.Body.Close()
	if atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("hits %d", hits)
	}
}

func TestResponseCacheSkipsErrors(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&hits, 1)
		if n == 1 {
			w.WriteHeader(500)
			_, _ = w.Write([]byte(`{"error":"x"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	resp := doChat(t, gw, cacheableChat())
	_ = resp.Body.Close()
	resp = doChat(t, gw, cacheableChat())
	_ = resp.Body.Close()
	if resp.Header.Get("X-Fabric-Cache") != "MISS" || atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("err cached? %s hits %d", resp.Header.Get("X-Fabric-Cache"), hits)
	}
}

func TestResponseCacheNoCrossProtocol(t *testing.T) {
	var chatHits, msgHits int32
	chatUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&chatHits, 1)
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(chatUp.Close)
	msgUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&msgHits, 1)
		_, _ = w.Write([]byte(`{"usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	t.Cleanup(msgUp.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: chatUp.URL, Secret: "sk-o"},
			{ID: 2, Protocol: store.ProtocolAnthropic, BaseURL: msgUp.URL, Secret: "sk-a"},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	body := `{"model":"x","messages":[],"fabric_context":{"preferences":{"cacheable":true}}}`
	resp := doChat(t, gw, body)
	_ = resp.Body.Close()
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(body))
	req.Header.Set("X-Api-Key", testVK)
	resp, _ = http.DefaultClient.Do(req)
	if resp.Header.Get("X-Fabric-Cache") != "MISS" {
		t.Fatalf("cross proto %s", resp.Header.Get("X-Fabric-Cache"))
	}
	_ = resp.Body.Close()
	if atomic.LoadInt32(&chatHits) != 1 || atomic.LoadInt32(&msgHits) != 1 {
		t.Fatalf("hits chat=%d msg=%d", chatHits, msgHits)
	}
}

func TestSSENeverResponseCachedPromptPassthrough(t *testing.T) {
	var hits int32
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		b, _ := io.ReadAll(r.Body)
		got = append(got, string(b))
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"z\"}}]}\n\n")
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	body := `{"model":"gpt-4","stream":true,"cache_control":{"type":"ephemeral"},"fabric_context":{"preferences":{"cacheable":true}}}`
	for i := 0; i < 2; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.Header.Get("X-Fabric-Cache") != "BYPASS" {
			t.Fatalf("sse cache %s", resp.Header.Get("X-Fabric-Cache"))
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
	if atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("hits %d", hits)
	}
	if len(got) != 2 || got[0] != body || got[1] != body {
		t.Fatalf("prompt cache field mutated %q", got)
	}
}

func TestCacheHitStillHonorsIPAndModel(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	vk := &store.ResolvedVK{VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
	}}
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{testVK: vk}}
	_, gw := v8srv(t, st, clk)
	resp := doChat(t, gw, cacheableChat())
	_ = resp.Body.Close()
	vk.IPAllow = []string{"10.0.0.1"}
	resp = doChat(t, gw, cacheableChat())
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("ip %d", resp.StatusCode)
	}
	vk.IPAllow = nil
	vk.ModelScope = []string{"other"}
	resp = doChat(t, gw, cacheableChat())
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("model %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
}

func TestVKApplicationApproveOnce(t *testing.T) {
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{PoolChannels: map[int64][]store.Channel{
		4: {{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}}
	_, gw := v8srv(t, st, clk)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/admin/v1/vk-applications", strings.NewReader(`{"pool_id":4,"purpose":"dev","monthly_hard":10,"model_scope":["gpt-4"],"ip_allow":["127.0.0.1"]}`))
	resp, _ := http.DefaultClient.Do(req)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anon %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/admin/v1/vk-applications", strings.NewReader(`{"pool_id":4,"purpose":"dev","monthly_hard":10,"model_scope":["gpt-4"]}`))
	req.Header.Set("X-Admin-Token", "adm-secret")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var created store.VKApplication
	_ = json.NewDecoder(resp.Body).Decode(&created)
	_ = resp.Body.Close()
	if resp.StatusCode != 201 || created.Status != store.AppPending || created.ID == 0 {
		t.Fatalf("create %+v %d", created, resp.StatusCode)
	}
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/admin/v1/vk-applications/"+itoa64(created.ID)+"/approve", nil)
	req.Header.Set("X-Admin-Token", "adm-secret")
	resp, _ = http.DefaultClient.Do(req)
	var first struct {
		Application store.VKApplication `json:"application"`
		VirtualKey  string              `json:"virtual_key"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&first)
	_ = resp.Body.Close()
	if first.VirtualKey == "" || !strings.HasPrefix(first.VirtualKey, "fab-") {
		t.Fatalf("missing plaintext %+v", first)
	}
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/admin/v1/vk-applications/"+itoa64(created.ID)+"/approve", nil)
	req.Header.Set("X-Admin-Token", "adm-secret")
	resp, _ = http.DefaultClient.Do(req)
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusConflict || strings.Contains(string(raw), first.VirtualKey) {
		t.Fatalf("reapprove %d %s", resp.StatusCode, raw)
	}
	chat, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	chat.Header.Set("Authorization", "Bearer "+first.VirtualKey)
	resp, _ = http.DefaultClient.Do(chat)
	if resp.StatusCode != 200 {
		t.Fatalf("use vk %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestVKApplicationRejectNoKey(t *testing.T) {
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{}
	_, gw := v8srv(t, st, clk)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/admin/v1/vk-applications", strings.NewReader(`{"purpose":"no"}`))
	req.Header.Set("X-Admin-Token", "adm-secret")
	resp, _ := http.DefaultClient.Do(req)
	var created store.VKApplication
	_ = json.NewDecoder(resp.Body).Decode(&created)
	_ = resp.Body.Close()
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/admin/v1/vk-applications/"+itoa64(created.ID)+"/reject", strings.NewReader(`{"reason":"nope"}`))
	req.Header.Set("X-Admin-Token", "adm-secret")
	resp, _ = http.DefaultClient.Do(req)
	var rejected store.VKApplication
	_ = json.NewDecoder(resp.Body).Decode(&rejected)
	_ = resp.Body.Close()
	if rejected.Status != store.AppRejected || rejected.RejectReason != "nope" {
		t.Fatalf("%+v", rejected)
	}
}

func TestAdminMissingTokenFailClosed(t *testing.T) {
	st := &store.Memory{}
	srv := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodGet, gw.URL+"/admin/v1/vk-applications", nil)
	req.Header.Set("X-Admin-Token", "anything")
	resp, _ := http.DefaultClient.Do(req)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestProviderKeyRotationOverlapAndRetire(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sec := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		got = append(got, sec)
		if sec == "sk-new" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"bad"}`))
			return
		}
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	act := clk.Now().Add(time.Hour)
	ret := clk.Now().Add(2 * time.Hour)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{{
			ID: 7, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-old", ProviderKeyID: 7,
		}}},
	}}
	_, gw := v8srv(t, st, clk)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/admin/v1/provider-keys/7/rotate", strings.NewReader(`{"secret":"sk-new","activate_at":"`+act.Format(time.RFC3339)+`","retire_at":"`+ret.Format(time.RFC3339)+`"}`))
	req.Header.Set("X-Admin-Token", "adm-secret")
	resp, _ := http.DefaultClient.Do(req)
	listRaw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 || strings.Contains(string(listRaw), "sk-new") || strings.Contains(string(listRaw), "sk-old") {
		t.Fatalf("stage %d %s", resp.StatusCode, listRaw)
	}
	do := func() *http.Response {
		return doChat(t, gw, `{"model":"gpt-4"}`)
	}
	r := do()
	if r.StatusCode != 200 {
		t.Fatalf("before activate %d", r.StatusCode)
	}
	_ = r.Body.Close()
	if strings.Join(got, ",") != "sk-old" {
		t.Fatalf("before activate %v", got)
	}
	clk.Advance(time.Hour + time.Minute)
	got = nil
	r = do()
	rawBody, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	if r.StatusCode != 200 {
		t.Fatalf("grace fallback %d %s", r.StatusCode, rawBody)
	}
	if len(got) < 2 || got[0] != "sk-new" || got[1] != "sk-old" {
		t.Fatalf("prefer new then fallback old %v", got)
	}
	if st.ByRawKey[testVK].Channels[0].Status == "disabled" {
		t.Fatal("disabled whole key after fallback success")
	}
	clk.Advance(time.Hour)
	got = nil
	r = do()
	_ = r.Body.Close()
	if strings.Join(got, ",") != "sk-new" {
		t.Fatalf("after retire %v", got)
	}
	lr, _ := http.NewRequest(http.MethodGet, gw.URL+"/admin/v1/provider-keys", nil)
	lr.Header.Set("X-Admin-Token", "adm-secret")
	resp, _ = http.DefaultClient.Do(lr)
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if strings.Contains(string(raw), "sk-") {
		t.Fatalf("list leaked %s", raw)
	}
}

func TestProviderKeyRotationSecondStagePromotes(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{{
			ID: 7, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-old", ProviderKeyID: 7,
		}}},
	}}
	_, gw := v8srv(t, st, clk)
	stage := func(secret, act, ret string) int {
		body := `{"secret":"` + secret + `"`
		if act != "" {
			body += `,"activate_at":"` + act + `"`
		}
		if ret != "" {
			body += `,"retire_at":"` + ret + `"`
		}
		body += `}`
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/admin/v1/provider-keys/7/rotate", strings.NewReader(body))
		req.Header.Set("X-Admin-Token", "adm-secret")
		resp, _ := http.DefaultClient.Do(req)
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	act1 := clk.Now().Add(time.Hour).Format(time.RFC3339)
	ret1 := clk.Now().Add(2 * time.Hour).Format(time.RFC3339)
	if stage("sk-new", act1, ret1) != 200 {
		t.Fatal("first stage")
	}
	if stage("sk-too-soon", act1, ret1) != http.StatusConflict {
		t.Fatal("pending restage")
	}
	clk.Advance(2*time.Hour + time.Minute)
	act2 := clk.Now().Add(time.Hour).Format(time.RFC3339)
	ret2 := clk.Now().Add(2 * time.Hour).Format(time.RFC3339)
	if stage("sk-newer", act2, ret2) != 200 {
		t.Fatal("second stage after done")
	}
	got = nil
	r := doChat(t, gw, `{"model":"gpt-4"}`)
	_ = r.Body.Close()
	if strings.Join(got, ",") != "sk-new" {
		t.Fatalf("before second activate want first new, got %v", got)
	}
	clk.Advance(time.Hour + time.Minute)
	got = nil
	r = doChat(t, gw, `{"model":"gpt-4"}`)
	_ = r.Body.Close()
	if strings.Join(got, ",") != "sk-newer" {
		t.Fatalf("after second activate %v", got)
	}
}

func TestProviderRotationRejectsBadScheduleAndMissing(t *testing.T) {
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{{
			ID: 7, Protocol: store.ProtocolOpenAI, BaseURL: "http://127.0.0.1:1", Secret: "sk-old", ProviderKeyID: 7,
		}}},
	}}
	_, gw := v8srv(t, st, clk)
	act := clk.Now().Add(2 * time.Hour).Format(time.RFC3339)
	ret := clk.Now().Add(time.Hour).Format(time.RFC3339)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/admin/v1/provider-keys/7/rotate", strings.NewReader(`{"secret":"sk-x","activate_at":"`+act+`","retire_at":"`+ret+`"}`))
	req.Header.Set("X-Admin-Token", "adm-secret")
	resp, _ := http.DefaultClient.Do(req)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad schedule %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/admin/v1/provider-keys/99/rotate", strings.NewReader(`{"secret":"sk-x"}`))
	req.Header.Set("X-Admin-Token", "adm-secret")
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/admin/v1/provider-keys/7/rotate/activate", nil)
	req.Header.Set("X-Admin-Token", "adm-secret")
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("activate none %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestPromptCacheTokensRecorded(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"prompt_tokens_details":{"cached_tokens":8}}}`))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	_, gw := v8srv(t, st, clk)
	resp := doChat(t, gw, `{"model":"gpt-4","messages":[{"cache_control":{"type":"ephemeral"},"content":"sys"}]}`)
	_ = resp.Body.Close()
	dec, _ := st.RecentRoutes(context.Background(), 1)
	if len(dec) == 0 || dec[0].CachedTokens != 8 {
		t.Fatalf("cached tokens %+v", dec)
	}
}

func containsStr(ss []string, v string) bool {
	for _, s := range ss {
		if s == v {
			return true
		}
	}
	return false
}

func itoa64(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
