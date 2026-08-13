package hub_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"kodax-fabric/internal/hub"
	"kodax-fabric/internal/store"
)

func testRedis(t *testing.T) *redis.Client {
	t.Helper()
	mr := miniredis.RunT(t)
	return redis.NewClient(&redis.Options{Addr: mr.Addr()})
}

func twoRedisServers(t *testing.T, st store.Store, rdb *redis.Client, clk *hub.FakeClock) (*hub.Server, *hub.Server, *httptest.Server, *httptest.Server) {
	t.Helper()
	wire := func() *hub.Server {
		s := hub.New(st, http.DefaultClient)
		s.Clock = clk
		s.Cache = hub.NewRedisCache(rdb, time.Hour)
		s.Budget = hub.NewRedisBudget(rdb)
		s.Limits = hub.NewRedisLimiter(rdb, clk)
		s.Redis = hub.RedisPinger{C: rdb}
		return s
	}
	s1, s2 := wire(), wire()
	g1 := httptest.NewServer(s1.Handler())
	g2 := httptest.NewServer(s2.Handler())
	t.Cleanup(g1.Close)
	t.Cleanup(g2.Close)
	return s1, s2, g1, g2
}

func TestRedisSharedCacheAndRPMAndBudget(t *testing.T) {
	rdb := testRedis(t)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(usageBody(5)))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 9, PoolID: 1, RPMLimit: 60, RPMBurst: 2, MonthlyHard: 10, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	_, _, g1, g2 := twoRedisServers(t, st, rdb, clk)

	body := cacheableChat()
	req, _ := http.NewRequest(http.MethodPost, g1.URL+"/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Header.Get("X-Fabric-Cache") != "MISS" {
		t.Fatalf("first %s", resp.Header.Get("X-Fabric-Cache"))
	}
	_ = resp.Body.Close()
	req, _ = http.NewRequest(http.MethodPost, g2.URL+"/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Header.Get("X-Fabric-Cache") != "HIT" {
		t.Fatalf("shared cache %s", resp.Header.Get("X-Fabric-Cache"))
	}
	_ = resp.Body.Close()
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}

	// Cache MISS already consumed one of burst=2. HIT does not take another token.
	plain := `{"model":"gpt-4","messages":[]}`
	req, _ = http.NewRequest(http.MethodPost, g1.URL+"/v1/chat/completions", strings.NewReader(plain))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 200 {
		t.Fatalf("remaining burst want 200 got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	req, _ = http.NewRequest(http.MethodPost, g1.URL+"/v1/chat/completions", strings.NewReader(plain))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 429 {
		t.Fatalf("burst exhausted on g1 want 429 got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	req, _ = http.NewRequest(http.MethodPost, g2.URL+"/v1/chat/completions", strings.NewReader(plain))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 429 {
		t.Fatalf("shared rpm on g2 want 429 got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestRedisProviderRPMSharedAcrossServers(t *testing.T) {
	rdb := testRedis(t)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(usageBody(5)))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 11, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up",
				ProviderCode: "mock-o", ProviderRPM: 60, ProviderBurst: 2},
		}},
	}}
	_, _, g1, g2 := twoRedisServers(t, st, rdb, clk)
	plain := `{"model":"gpt-4","messages":[]}`
	for i, g := range []*httptest.Server{g1, g2} {
		req, _ := http.NewRequest(http.MethodPost, g.URL+"/v1/chat/completions", strings.NewReader(plain))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("provider burst %d want 200 got %d", i, resp.StatusCode)
		}
		_ = resp.Body.Close()
	}
	req, _ := http.NewRequest(http.MethodPost, g1.URL+"/v1/chat/completions", strings.NewReader(plain))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 429 {
		t.Fatalf("shared provider rpm want 429 got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestRedisBudgetConcurrentNoPierce(t *testing.T) {
	rdb := testRedis(t)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	var hits int32
	release := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		<-release
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(usageBody(2)))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 3, PoolID: 1, MonthlyHard: 10, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	s1 := hub.New(st, http.DefaultClient)
	s1.Clock, s1.Budget, s1.Limits = clk, hub.NewRedisBudget(rdb), hub.NewRedisLimiter(rdb, clk)
	s2 := hub.New(st, http.DefaultClient)
	s2.Clock, s2.Budget, s2.Limits = clk, hub.NewRedisBudget(rdb), hub.NewRedisLimiter(rdb, clk)
	g1 := httptest.NewServer(s1.Handler())
	g2 := httptest.NewServer(s2.Handler())
	t.Cleanup(g1.Close)
	t.Cleanup(g2.Close)
	const n = 8
	var wg sync.WaitGroup
	var ok, blocked int32
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			u := g1.URL
			if i%2 == 1 {
				u = g2.URL
			}
			req, _ := http.NewRequest(http.MethodPost, u+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[],"max_tokens":5}`))
			req.Header.Set("Authorization", "Bearer "+testVK)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode == 200 {
				atomic.AddInt32(&ok, 1)
			} else if resp.StatusCode == http.StatusPaymentRequired {
				atomic.AddInt32(&blocked, 1)
			}
		}(i)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && atomic.LoadInt32(&hits) < 2 {
		time.Sleep(5 * time.Millisecond)
	}
	if atomic.LoadInt32(&hits) != 2 {
		close(release)
		wg.Wait()
		t.Fatalf("hits %d", hits)
	}
	close(release)
	wg.Wait()
	if atomic.LoadInt32(&ok) != 2 || atomic.LoadInt32(&blocked) != n-2 {
		t.Fatalf("ok=%d blocked=%d", ok, blocked)
	}
}

func TestRedisBudgetFailClosed(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	b := hub.NewRedisBudget(rdb)
	if _, ok := b.Reserve(1, "2026-01", 10, hub.ReserveSpec{OutputCap: 5, HasCap: true}); !ok {
		t.Fatal("reserve while up")
	}
	mr.Close()
	if _, ok := b.Reserve(1, "2026-01", 10, hub.ReserveSpec{OutputCap: 5, HasCap: true}); ok {
		t.Fatal("hard budget must fail closed when redis is down")
	}
	if _, ok := b.Reserve(1, "2026-01", 0, hub.ReserveSpec{}); !ok {
		t.Fatal("unlimited still allowed")
	}
}
