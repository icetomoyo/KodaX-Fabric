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

func TestProviderRPMFromCatalog(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{
		ProviderKeys: []store.ProviderKeyView{
			{ID: 1, ProviderCode: "openai", Status: store.StatusActive, RPMLimit: 2},
		},
		ByRawKey: map[string]*store.ResolvedVK{
			testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
				{ID: 1, ProviderCode: "openai", Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"},
			}},
		},
	}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)
	var last int
	for i := 0; i < 4; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		last = resp.StatusCode
		_ = resp.Body.Close()
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("4th status %d want 429 (catalog provider rpm)", last)
	}
	if atomic.LoadInt32(&hits) != 3 {
		t.Fatalf("hits %d want 3", hits)
	}
}

func TestAliasesFromStore(t *testing.T) {
	var got string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got = string(b)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(dead.Close)
	st := &store.Memory{
		AliasList: []store.ModelAlias{
			{Protocol: store.ProtocolOpenAI, Model: "gpt-4", Fallback: "gpt-4o"},
		},
		ByRawKey: map[string]*store.ResolvedVK{
			testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
				{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: dead.URL, Secret: "sk", Priority: 1, Models: []string{"gpt-4"}},
				{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk", Priority: 1, Models: []string{"gpt-4o"}},
			}},
		},
	}
	s := hub.New(st, http.DefaultClient)
	al, err := st.ModelAliases(nil)
	if err != nil {
		t.Fatal(err)
	}
	s.Aliases = al
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
	if !strings.Contains(got, `"model":"gpt-4o"`) {
		t.Fatalf("alias not applied: %s", got)
	}
}
