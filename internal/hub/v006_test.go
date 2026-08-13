package hub_test

import (
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

func TestVKRPMHard429(t *testing.T) {
	var hitA, hitB int32
	upA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hitA, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(upA.Close)
	upB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hitB, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(upB.Close)

	// RPM=5 → burst ceil(6)=6 allowed, then 429.
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-limited": {
			VirtualKeyID: 1, PoolID: 1, RPMLimit: 5,
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: upA.URL, Secret: "sk-a"}},
		},
		"fab-other": {
			VirtualKeyID: 2, PoolID: 1,
			Channels: []store.Channel{{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: upB.URL, Secret: "sk-b"}},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	var lastLimited *http.Response
	for i := 0; i < 7; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer fab-limited")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if i < 6 {
			if resp.StatusCode != 200 {
				raw, _ := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				t.Fatalf("req %d status %d body %s", i+1, resp.StatusCode, raw)
			}
			_ = resp.Body.Close()
			continue
		}
		lastLimited = resp
	}
	raw, _ := io.ReadAll(lastLimited.Body)
	_ = lastLimited.Body.Close()
	if lastLimited.StatusCode != 429 {
		t.Fatalf("7th status %d body %s", lastLimited.StatusCode, raw)
	}
	if !strings.Contains(string(raw), "rate_limited") {
		t.Fatalf("429 envelope %s", raw)
	}
	if atomic.LoadInt32(&hitA) != 6 {
		t.Fatalf("limited VK upstream hits %d want 6", hitA)
	}

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(`{"model":"claude"}`))
	req.Header.Set("X-Api-Key", "fab-limited")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 429 {
		t.Fatalf("messages after cap %d", resp.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-other")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("other VK status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hitB) != 1 {
		t.Fatalf("other VK hits %d", hitB)
	}
}

func TestProviderRPMSharedBucket(t *testing.T) {
	var hitOA, hitOB, hitOther int32
	upOA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hitOA, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(upOA.Close)
	upOB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hitOB, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(upOB.Close)
	upOther := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hitOther, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(upOther.Close)

	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-oa": {
			VirtualKeyID: 1, PoolID: 1,
			ProviderRPM: map[string]int{"openai": 2},
			Channels: []store.Channel{
				{ID: 1, ProviderCode: "openai", Protocol: store.ProtocolOpenAI, BaseURL: upOA.URL, Secret: "sk-1", Priority: 1},
				{ID: 2, ProviderCode: "openai", Protocol: store.ProtocolOpenAI, BaseURL: upOB.URL, Secret: "sk-2", Priority: 2},
			},
		},
		"fab-mix": {
			VirtualKeyID: 2, PoolID: 1,
			ProviderRPM: map[string]int{"openai": 2},
			Channels: []store.Channel{
				{ID: 1, ProviderCode: "openai", Protocol: store.ProtocolOpenAI, BaseURL: upOA.URL, Secret: "sk-1", Priority: 1},
				{ID: 3, ProviderCode: "deepseek", Protocol: store.ProtocolOpenAI, BaseURL: upOther.URL, Secret: "sk-3", Priority: 2},
			},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	// RPM=2 → burst 3. Fourth request on openai-only VK is 429.
	var last *http.Response
	for i := 0; i < 4; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer fab-oa")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if i < 3 {
			if resp.StatusCode != 200 {
				raw, _ := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				t.Fatalf("oa %d status %d %s", i+1, resp.StatusCode, raw)
			}
			_ = resp.Body.Close()
			continue
		}
		last = resp
	}
	raw, _ := io.ReadAll(last.Body)
	_ = last.Body.Close()
	if last.StatusCode != 429 {
		t.Fatalf("oa 4th %d %s", last.StatusCode, raw)
	}
	if atomic.LoadInt32(&hitOA)+atomic.LoadInt32(&hitOB) != 3 {
		t.Fatalf("openai hits A=%d B=%d", hitOA, hitOB)
	}

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-mix")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("mix status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hitOther) != 1 {
		t.Fatalf("deepseek should take leftover traffic, hits=%d openaiA=%d", hitOther, hitOA)
	}
}

func TestSickChannelTrippedOver(t *testing.T) {
	var primary, backup, stray int32
	p := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&primary, 1)
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"p"}`))
	}))
	t.Cleanup(p.Close)
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&backup, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(b.Close)
	strayUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&stray, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(strayUp.Close)

	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-cb": {
			VirtualKeyID: 1, PoolID: 10, TeamID: 1,
			Channels: []store.Channel{
				{ID: 1, PoolID: 10, TeamID: 1, KeyTeamID: 1, Protocol: store.ProtocolOpenAI, BaseURL: p.URL, Secret: "sk-p", Priority: 1},
				{ID: 2, PoolID: 10, TeamID: 1, KeyTeamID: 1, Protocol: store.ProtocolOpenAI, BaseURL: b.URL, Secret: "sk-b", Priority: 2},
				{ID: 9, PoolID: 10, TeamID: 1, KeyTeamID: 2, Protocol: store.ProtocolOpenAI, BaseURL: strayUp.URL, Secret: "sk-x", Priority: 2},
			},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	for i := 0; i < 3; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer fab-cb")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("warmup %d status %d", i, resp.StatusCode)
		}
	}
	if atomic.LoadInt32(&primary) != 3 {
		t.Fatalf("primary during warmup %d", primary)
	}

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-cb")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("after open status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&primary) != 3 {
		t.Fatalf("open circuit still hit primary: %d", primary)
	}
	if atomic.LoadInt32(&backup) < 4 {
		t.Fatalf("backup hits %d", backup)
	}
	if atomic.LoadInt32(&stray) != 0 {
		t.Fatalf("cross-team key used on failover: %d", stray)
	}
}

func TestClient4xxDoesNotTripCircuit(t *testing.T) {
	var primary, backup int32
	p := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&primary, 1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"bad"}`))
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
	for i := 0; i < 4; i++ {
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
	}
	if atomic.LoadInt32(&primary) != 4 || atomic.LoadInt32(&backup) != 0 {
		t.Fatalf("4xx retried or tripped: p=%d b=%d", primary, backup)
	}
}

func TestHalfOpenAfterCooldown(t *testing.T) {
	var primary, backup int32
	p := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&primary, 1)
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"p"}`))
	}))
	t.Cleanup(p.Close)
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&backup, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(b.Close)

	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {
			VirtualKeyID: 1, PoolID: 1,
			Channels: []store.Channel{
				{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: p.URL, Secret: "sk-p", Priority: 1},
				{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: b.URL, Secret: "sk-b", Priority: 2},
			},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	s.Now = func() time.Time { return now }
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	post := func() int {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	for i := 0; i < 3; i++ {
		if post() != 200 {
			t.Fatalf("warmup %d", i)
		}
	}
	if post() != 200 {
		t.Fatal("still open")
	}
	if atomic.LoadInt32(&primary) != 3 {
		t.Fatalf("before cool primary %d", primary)
	}

	now = now.Add(30 * time.Second)
	if post() != 200 {
		t.Fatal("half-open probe")
	}
	if atomic.LoadInt32(&primary) != 4 {
		t.Fatalf("half-open should probe primary, got %d", primary)
	}

	if post() != 200 {
		t.Fatal("re-opened")
	}
	if atomic.LoadInt32(&primary) != 4 {
		t.Fatalf("failed probe should re-open, primary %d", primary)
	}
}

func TestHalfOpenSuccessCloses(t *testing.T) {
	var primary int32
	p := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&primary, 1)
		if n <= 3 {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":"p"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(p.Close)
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(b.Close)

	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {
			VirtualKeyID: 1, PoolID: 1,
			Channels: []store.Channel{
				{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: p.URL, Secret: "sk-p", Priority: 1},
				{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: b.URL, Secret: "sk-b", Priority: 2},
			},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	s.Now = func() time.Time { return now }
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	post := func() {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
	}
	for i := 0; i < 4; i++ {
		post()
	}
	now = now.Add(30 * time.Second)
	post() // probe success
	post() // closed: primary again
	if atomic.LoadInt32(&primary) != 5 {
		t.Fatalf("after close primary hits %d want 5", primary)
	}
}
