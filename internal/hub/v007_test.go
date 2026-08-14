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

func TestBudgetHard402ZeroUpstream(t *testing.T) {
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
		"fab-broke": {
			VirtualKeyID: 1, PoolID: 1, BudgetLimit: 100, BudgetUsed: 100,
			Channels: []store.Channel{
				{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: upA.URL, Secret: "sk-a"},
				{ID: 2, Protocol: store.ProtocolAnthropic, BaseURL: upA.URL, Secret: "sk-a"},
			},
		},
		"fab-ok": {
			VirtualKeyID: 2, PoolID: 1,
			Channels: []store.Channel{{ID: 3, Protocol: store.ProtocolOpenAI, BaseURL: upB.URL, Secret: "sk-b"}},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-broke")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 402 {
		t.Fatalf("chat status %d body %s", resp.StatusCode, raw)
	}
	if !strings.Contains(string(raw), "budget_exceeded") {
		t.Fatalf("envelope %s", raw)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(`{"model":"claude"}`))
	req.Header.Set("X-Api-Key", "fab-broke")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 402 {
		t.Fatalf("messages status %d body %s", resp.StatusCode, raw)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-ok")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("other VK %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hitA) != 0 || atomic.LoadInt32(&hitB) != 1 {
		t.Fatalf("hits A=%d B=%d", hitA, hitB)
	}
}

func TestBudgetSoftWarnStillHitsUpstream(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-soft": {
			VirtualKeyID: 1, PoolID: 1, BudgetLimit: 100, BudgetUsed: 80,
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"}},
		},
		"fab-low": {
			VirtualKeyID: 2, PoolID: 1, BudgetLimit: 100, BudgetUsed: 79,
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"}},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-soft")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("soft status %d", resp.StatusCode)
	}
	if resp.Header.Get("X-Fabric-Budget-Warn") != "true" {
		t.Fatalf("missing warn header")
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("soft hits %d", hits)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-low")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("low status %d", resp.StatusCode)
	}
	if resp.Header.Get("X-Fabric-Budget-Warn") != "" {
		t.Fatalf("unexpected warn %q", resp.Header.Get("X-Fabric-Budget-Warn"))
	}
}

func TestUsageAccrueThenHardReject(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody())) // total_tokens=5
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-cap": {
			VirtualKeyID: 1, PoolID: 1, BudgetLimit: 5, BudgetUsed: 0,
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"}},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-cap")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("first %d", resp.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-cap")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 402 {
		t.Fatalf("second %d %s", resp.StatusCode, raw)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d want 1", hits)
	}
}

func TestStreamUsageCommentsGrow(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		for _, c := range []string{
			"data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n",
			"data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n",
			"data: {\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":8,\"total_tokens\":11}}\n\n",
			"data: [DONE]\n\n",
		} {
			_, _ = io.WriteString(w, c)
			fl.Flush()
		}
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {
			VirtualKeyID: 1, PoolID: 1, BudgetLimit: 11,
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"}},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","stream":true}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	got := string(raw)
	if !strings.Contains(got, `"content":"hello"`) || !strings.Contains(got, "[DONE]") {
		t.Fatalf("mutated data: %s", got)
	}
	if !strings.Contains(got, ": fabric-usage ") {
		t.Fatalf("no usage comments: %s", got)
	}
	// next request should be 402 if we calibrated to official 11
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 402 {
		t.Fatalf("after stream calibrate %d", resp.StatusCode)
	}
}

func TestBudgetResetsNextMonth(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-m": {
			VirtualKeyID: 1, PoolID: 1, BudgetLimit: 5, BudgetUsed: 5, BudgetMonth: "2026-08",
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"}},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	s.Now = func() time.Time { return now }
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-m")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 402 {
		t.Fatalf("same month %d", resp.StatusCode)
	}

	now = time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-m")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("next month %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
}
