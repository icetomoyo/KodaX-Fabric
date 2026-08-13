package hub_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"kodax-fabric/internal/hub"
	"kodax-fabric/internal/store"
)

func TestTwoVKsDifferentPools(t *testing.T) {
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

	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-team-a": {
			VirtualKeyID: 1, PoolID: 10, TeamID: 1, ProjectID: 1,
			Channels: []store.Channel{
				{ID: 1, PoolID: 10, TeamID: 1, KeyTeamID: 1, Protocol: store.ProtocolOpenAI, BaseURL: upA.URL, Secret: "sk-a"},
				{ID: 2, PoolID: 20, TeamID: 2, KeyTeamID: 2, Protocol: store.ProtocolOpenAI, BaseURL: upB.URL, Secret: "sk-b"},
			},
		},
		"fab-team-b": {
			VirtualKeyID: 2, PoolID: 20, TeamID: 2, ProjectID: 2,
			Channels: []store.Channel{
				{ID: 1, PoolID: 10, TeamID: 1, KeyTeamID: 1, Protocol: store.ProtocolOpenAI, BaseURL: upA.URL, Secret: "sk-a"},
				{ID: 2, PoolID: 20, TeamID: 2, KeyTeamID: 2, Protocol: store.ProtocolOpenAI, BaseURL: upB.URL, Secret: "sk-b"},
			},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-team-a")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("A status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hitA) != 1 || atomic.LoadInt32(&hitB) != 0 {
		t.Fatalf("A should only hit pool A: A=%d B=%d", hitA, hitB)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-team-b")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("B status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hitA) != 1 || atomic.LoadInt32(&hitB) != 1 {
		t.Fatalf("B should only hit pool B: A=%d B=%d", hitA, hitB)
	}
}

func TestCrossTeamKeyFiltered(t *testing.T) {
	var hitA, hitB, hitBAnth int32
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
	upBAnth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hitBAnth, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"m","type":"message","role":"assistant","content":[]}`))
	}))
	t.Cleanup(upBAnth.Close)

	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-team-a": {
			VirtualKeyID: 1, PoolID: 10, TeamID: 1, ProjectID: 1,
			Channels: []store.Channel{
				{ID: 1, PoolID: 10, TeamID: 1, KeyTeamID: 1, Protocol: store.ProtocolOpenAI, BaseURL: upA.URL, Secret: "sk-a"},
				{ID: 2, PoolID: 10, TeamID: 1, KeyTeamID: 2, Protocol: store.ProtocolOpenAI, BaseURL: upB.URL, Secret: "sk-b"},
				{ID: 3, PoolID: 10, TeamID: 1, KeyTeamID: 2, Protocol: store.ProtocolAnthropic, BaseURL: upBAnth.URL, Secret: "sk-b-anth"},
			},
		},
		"fab-orphan": {
			VirtualKeyID: 3, PoolID: 10, TeamID: 0,
			Channels: []store.Channel{
				{ID: 1, PoolID: 10, TeamID: 1, KeyTeamID: 1, Protocol: store.ProtocolOpenAI, BaseURL: upA.URL, Secret: "sk-a"},
			},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-team-a")
	req.Header.Set("X-Team-Id", "2")
	req.Header.Set("X-Pool-Id", "20")
	req.Header.Set("X-Fabric-Pool-Group", "bulk")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("A status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hitA) != 1 || atomic.LoadInt32(&hitB) != 0 {
		t.Fatalf("mis-hung B key and forged headers must not change hit: A=%d B=%d", hitA, hitB)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(`{"model":"claude"}`))
	req.Header.Set("X-Api-Key", "fab-team-a")
	req.Header.Set("X-Team-Id", "2")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 503 {
		t.Fatalf("messages with only mis-hung B anth key want 503 got %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hitB) != 0 || atomic.LoadInt32(&hitBAnth) != 0 {
		t.Fatalf("messages must not hit B keys: B=%d anth=%d", hitB, hitBAnth)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-orphan")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 503 {
		t.Fatalf("orphan VK status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hitA) != 1 || atomic.LoadInt32(&hitB) != 0 || atomic.LoadInt32(&hitBAnth) != 0 {
		t.Fatalf("orphan VK must not hit team keys: A=%d B=%d anth=%d", hitA, hitB, hitBAnth)
	}
}

func TestMisHungKeyNotUsedOnFailover(t *testing.T) {
	var hitB int32
	upA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"a"}`))
	}))
	t.Cleanup(upA.Close)
	upB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hitB, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(upB.Close)

	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-team-a": {
			VirtualKeyID: 1, PoolID: 10, TeamID: 1, ProjectID: 1,
			Channels: []store.Channel{
				{ID: 1, PoolID: 10, TeamID: 1, KeyTeamID: 1, Protocol: store.ProtocolOpenAI, BaseURL: upA.URL, Secret: "sk-a", Priority: 1},
				{ID: 2, PoolID: 10, TeamID: 1, KeyTeamID: 2, Protocol: store.ProtocolOpenAI, BaseURL: upB.URL, Secret: "sk-b", Priority: 2},
			},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-team-a")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 502 && resp.StatusCode != 503 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hitB) != 0 {
		t.Fatalf("failover must not pick mis-hung B key: B=%d", hitB)
	}
}

func TestPoolGroupVisible(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)

	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{}}
	for i, g := range []string{"premium", "standard", "bulk"} {
		st.ByRawKey["fab-"+g] = &store.ResolvedVK{
			VirtualKeyID: int64(i + 1), PoolID: int64(10 + i), TeamID: int64(i + 1), ProjectID: int64(i + 1),
			PoolGroup: g,
			Channels: []store.Channel{
				{ID: int64(i + 1), PoolID: int64(10 + i), TeamID: int64(i + 1), KeyTeamID: int64(i + 1), Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"},
			},
		}
	}
	var audits []store.RouteDecision
	s := hub.New(st, http.DefaultClient)
	s.Audit = func(d store.RouteDecision) error {
		audits = append(audits, d)
		return nil
	}
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	for _, g := range []string{"premium", "standard", "bulk"} {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer fab-"+g)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("%s status %d", g, resp.StatusCode)
		}
		if got := resp.Header.Get("X-Fabric-Pool-Group"); got != g {
			t.Fatalf("%s header %q", g, got)
		}
	}
	if len(audits) != 3 {
		t.Fatalf("audits %d", len(audits))
	}
	for i, g := range []string{"premium", "standard", "bulk"} {
		if audits[i].PoolGroup != g {
			t.Fatalf("audit[%d] group %q want %s", i, audits[i].PoolGroup, g)
		}
	}
}
