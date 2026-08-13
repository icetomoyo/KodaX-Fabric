package hub_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"kodax-fabric/internal/hub"
	"kodax-fabric/internal/store"
)

func TestPrimary5xxFailsOverToBackup(t *testing.T) {
	var primary, backup int32
	p := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&primary, 1)
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"primary"}`))
	}))
	t.Cleanup(p.Close)
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&backup, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(b.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: p.URL, Secret: "sk-p", Priority: 1},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: b.URL, Secret: "sk-b", Priority: 2},
	})
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d body %s", resp.StatusCode, raw)
	}
	if atomic.LoadInt32(&primary) != 1 || atomic.LoadInt32(&backup) != 1 {
		t.Fatalf("hits primary=%d backup=%d", primary, backup)
	}
}

func TestPrimaryNetworkErrorFailsOverToBackup(t *testing.T) {
	var backup int32
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&backup, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(b.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: "http://127.0.0.1:1", Secret: "sk-p", Priority: 1},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: b.URL, Secret: "sk-b", Priority: 2},
	})
	t.Cleanup(gw.Close)

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
	if atomic.LoadInt32(&backup) != 1 {
		t.Fatalf("backup hits %d", backup)
	}
}

func Test400DoesNotRetryBackup(t *testing.T) {
	var primary, backup int32
	p := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&primary, 1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"bad"}`))
	}))
	t.Cleanup(p.Close)
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&backup, 1)
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(b.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: p.URL, Secret: "sk-p", Priority: 1},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: b.URL, Secret: "sk-b", Priority: 2},
	})
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&primary) != 1 || atomic.LoadInt32(&backup) != 0 {
		t.Fatalf("primary=%d backup=%d", primary, backup)
	}
}

func Test401DoesNotFailoverThisRequest(t *testing.T) {
	var backup int32
	p := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"bad key"}`))
	}))
	t.Cleanup(p.Close)
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&backup, 1)
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(b.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: p.URL, Secret: "sk-p", Priority: 1},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: b.URL, Secret: "sk-b", Priority: 2},
	})
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&backup) != 0 {
		t.Fatal("401 must not failover this request")
	}
}

func TestWeightedSamePriorityThreeToOne(t *testing.T) {
	var a, b int32
	upA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&a, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(upA.Close)
	upB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&b, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(upB.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: upA.URL, Secret: "sk-a", Priority: 1, Weight: 3},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: upB.URL, Secret: "sk-b", Priority: 1, Weight: 1},
	})
	t.Cleanup(gw.Close)
	for i := 0; i < 8; i++ {
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
	}
	if atomic.LoadInt32(&a) != 6 || atomic.LoadInt32(&b) != 2 {
		t.Fatalf("weight hits A=%d B=%d want 6/2", a, b)
	}
}

func TestWeightedRRIsolatedByModel(t *testing.T) {
	var a int32
	upA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&a, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(upA.Close)
	upB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(upB.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: upA.URL, Secret: "sk-a", Priority: 1, Weight: 1},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: upB.URL, Secret: "sk-b", Priority: 1, Weight: 1},
	})
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, _ := http.DefaultClient.Do(req)
	_ = resp.Body.Close()
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, _ = http.DefaultClient.Do(req)
	_ = resp.Body.Close()
	if atomic.LoadInt32(&a) != 2 {
		t.Fatalf("different models should not share RR pointer, A hits %d want 2", a)
	}
}

func TestRouteAuditHeadersOnFailover(t *testing.T) {
	p := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"p"}`))
	}))
	t.Cleanup(p.Close)
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(b.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 11, Protocol: store.ProtocolOpenAI, BaseURL: p.URL, Secret: "sk-p", Priority: 1},
		{ID: 22, Protocol: store.ProtocolOpenAI, BaseURL: b.URL, Secret: "sk-b", Priority: 2},
	})
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.Header.Get("X-Fabric-Request-Id") == "" {
		t.Fatal("missing request id")
	}
	route := resp.Header.Get("X-Fabric-Route")
	if !strings.Contains(route, "22") || !strings.Contains(strings.ToLower(route), "failover") {
		t.Fatalf("route %q", route)
	}
	if resp.Header.Get("X-Fabric-Fallback") != "true" {
		t.Fatalf("fallback %q", resp.Header.Get("X-Fabric-Fallback"))
	}
}

func TestAuditWriteFailureStillReturnsBody(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-a"},
		}},
	}}
	s := hub.New(st, http.DefaultClient)
	s.Audit = func(store.RouteDecision) error { return io.ErrUnexpectedEOF }
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(raw), "hello-fixed") {
		t.Fatalf("status %d body %s", resp.StatusCode, raw)
	}
}

func TestModelAliasFallbackRewritesModelOnly(t *testing.T) {
	const wantRest = `"messages":[{"role":"user","content":"x"}]`
	var gotBody string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"dead"}`))
	}))
	t.Cleanup(dead.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: dead.URL, Secret: "sk-p", Priority: 1, Models: []string{"gpt-4"}},
			{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-b", Priority: 1, Models: []string{"gpt-4o"}},
		}},
	}}
	s := hub.New(st, http.DefaultClient)
	s.Aliases = map[string]string{store.ProtocolOpenAI + "|gpt-4": "gpt-4o"}
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[{"role":"user","content":"x"}]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if !strings.Contains(gotBody, `"model":"gpt-4o"`) {
		t.Fatalf("upstream model not rewritten: %s", gotBody)
	}
	if !strings.Contains(gotBody, wantRest) {
		t.Fatalf("body mutated beyond model: %s", gotBody)
	}
}

func TestNoCrossProtocolOnFailover(t *testing.T) {
	var other int32
	anth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&other, 1)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(anth.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: "http://127.0.0.1:1", Secret: "sk-p", Priority: 1},
		{ID: 2, Protocol: store.ProtocolAnthropic, BaseURL: anth.URL, Secret: "sk-a", Priority: 1},
	})
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 502 && resp.StatusCode != 503 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&other) != 0 {
		t.Fatal("crossed to Anthropic")
	}
}
