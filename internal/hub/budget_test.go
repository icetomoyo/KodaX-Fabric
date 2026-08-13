package hub

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestAnthropicCacheTokensSplit(t *testing.T) {
	u := extractUsage([]byte(`{"usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":20,"cache_read_input_tokens":8}}`))
	if u.tokens() != 43 {
		t.Fatalf("anthropic total %d", u.tokens())
	}
	if extractCachedTokens(u) != 8 {
		t.Fatalf("hit savings %d", extractCachedTokens(u))
	}
	oai := extractUsage([]byte(`{"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"prompt_tokens_details":{"cached_tokens":9}}}`))
	if extractCachedTokens(oai) != 9 || oai.tokens() != 12 {
		t.Fatalf("openai %+v", oai)
	}
}

func TestParseUsageOpenAIAndAnthropic(t *testing.T) {
	if n := parseUsageTokens([]byte(`{"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`)); n != 5 {
		t.Fatalf("openai total %d", n)
	}
	if n := parseUsageTokens([]byte(`{"usage":{"prompt_tokens":3,"completion_tokens":2}}`)); n != 5 {
		t.Fatalf("openai sum %d", n)
	}
	if n := parseUsageTokens([]byte(`{"usage":{"input_tokens":11,"output_tokens":7}}`)); n != 18 {
		t.Fatalf("anthropic top %d", n)
	}
	if n := parseUsageTokens([]byte(`{"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":1}}}`)); n != 10 {
		t.Fatalf("anthropic nested %d", n)
	}
	acc := parseUsageFromSSE([]byte(
		"data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":9,\"output_tokens\":1}}}\n\n" +
			"data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":12}}\n\n",
	))
	if acc.tokens() != 21 {
		t.Fatalf("merged anthropic sse %d", acc.tokens())
	}
}

func TestParseOutputCap(t *testing.T) {
	if n, ok := parseOutputCap([]byte(`{"max_tokens":5}`)); !ok || n != 5 {
		t.Fatalf("max_tokens %d %v", n, ok)
	}
	if n, ok := parseOutputCap([]byte(`{"max_completion_tokens":8,"max_tokens":5}`)); !ok || n != 8 {
		t.Fatalf("completion wins %d %v", n, ok)
	}
	if _, ok := parseOutputCap([]byte(`{"model":"gpt-4"}`)); ok {
		t.Fatal("no cap")
	}
}

func TestSettleReplacesEstimate(t *testing.T) {
	b := NewMemoryBudget(NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)))
	lease, ok := b.Reserve(1, "2026-01", 100, ReserveSpec{Input: 3, OutputCap: 40, HasCap: true})
	if !ok {
		t.Fatal("reserve")
	}
	b.Observe(lease, 17)
	if got := b.Snap(1, "2026-01"); got.Used != 17 || got.Reserved != 26 || got.Used+got.Reserved != 43 {
		t.Fatalf("mid %+v", got)
	}
	snap := b.Settle(lease, 40)
	if snap.Used != 40 || snap.Settled != 40 || snap.Reserved != 0 {
		t.Fatalf("settled %+v", snap)
	}
	b.Settle(lease, 99)
	if got := b.Snap(1, "2026-01").Used; got != 40 {
		t.Fatalf("double settle %d", got)
	}
}

func TestReserveConcurrentTokens(t *testing.T) {
	b := NewMemoryBudget(NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)))
	start := make(chan struct{})
	release := make(chan struct{})
	var okN int32
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			lease, ok := b.Reserve(7, "2026-01", 10, ReserveSpec{OutputCap: 5, HasCap: true})
			if !ok {
				return
			}
			atomic.AddInt32(&okN, 1)
			<-release
			b.Release(lease)
		}()
	}
	close(start)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && atomic.LoadInt32(&okN) < 2 {
		time.Sleep(time.Millisecond)
	}
	if atomic.LoadInt32(&okN) != 2 {
		close(release)
		wg.Wait()
		t.Fatalf("reserved %d", okN)
	}
	snap := b.Snap(7, "2026-01")
	if snap.Used+snap.Reserved > 10 {
		close(release)
		wg.Wait()
		t.Fatalf("pierce %+v", snap)
	}
	close(release)
	wg.Wait()
}

func TestUnknownCapTakesRemainder(t *testing.T) {
	b := NewMemoryBudget(NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)))
	l1, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{Input: 1})
	if !ok || l1.Reserved != 10 {
		t.Fatalf("first %+v %v", l1, ok)
	}
	if _, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{Input: 1}); ok {
		t.Fatal("second unknown-cap should wait")
	}
	b.Release(l1)
	if _, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{Input: 1}); !ok {
		t.Fatal("after release")
	}
}

func TestMonthKeysIsolated(t *testing.T) {
	b := NewMemoryBudget(NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)))
	l, ok := b.Reserve(1, "2026-01", 90, ReserveSpec{OutputCap: 90, HasCap: true})
	if !ok {
		t.Fatal("jan reserve")
	}
	b.Settle(l, 90)
	if _, ok := b.Reserve(1, "2026-01", 90, ReserveSpec{OutputCap: 1, HasCap: true}); ok {
		t.Fatal("jan should be exhausted")
	}
	if _, ok := b.Reserve(1, "2026-02", 90, ReserveSpec{OutputCap: 90, HasCap: true}); !ok {
		t.Fatal("feb should be a new bucket")
	}
	if _, ok := b.Reserve(2, "2026-01", 90, ReserveSpec{OutputCap: 90, HasCap: true}); !ok {
		t.Fatal("other vk must not share jan")
	}
}

func TestAllStableMonthSort(t *testing.T) {
	b := NewMemoryBudget(NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)))
	l2, _ := b.Reserve(2, "2026-02", 10, ReserveSpec{OutputCap: 1, HasCap: true})
	l1, _ := b.Reserve(1, "2026-03", 10, ReserveSpec{OutputCap: 1, HasCap: true})
	l0, _ := b.Reserve(1, "2026-01", 10, ReserveSpec{OutputCap: 1, HasCap: true})
	b.Settle(l2, 1)
	b.Settle(l1, 1)
	b.Settle(l0, 1)
	all := b.All()
	if len(all) != 3 || all[0].VirtualKeyID != 1 || all[0].Month != "2026-01" || all[1].Month != "2026-03" || all[2].VirtualKeyID != 2 {
		t.Fatalf("all %+v", all)
	}
}

func TestOfficialOverageNotClamped(t *testing.T) {
	b := NewMemoryBudget(NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)))
	l, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{OutputCap: 5, HasCap: true})
	if !ok {
		t.Fatal("reserve")
	}
	snap := b.Settle(l, 12)
	if snap.Settled != 12 {
		t.Fatalf("clamped %+v", snap)
	}
	if _, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{OutputCap: 1, HasCap: true}); ok {
		t.Fatal("overage must block next")
	}
}

func TestSoftLimitDefault80(t *testing.T) {
	if softLimit(100, 0) != 80 {
		t.Fatalf("default %d", softLimit(100, 0))
	}
	if softLimit(100, 50) != 50 {
		t.Fatalf("explicit %d", softLimit(100, 50))
	}
	if softLimit(0, 0) != 0 {
		t.Fatal("unlimited")
	}
}

func TestBudgetMonthUTC(t *testing.T) {
	if BudgetMonth(time.Date(2026, 1, 31, 23, 0, 0, 0, time.UTC)) != "2026-01" {
		t.Fatal(BudgetMonth(time.Date(2026, 1, 31, 23, 0, 0, 0, time.UTC)))
	}
	if BudgetMonth(time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)) != "2026-02" {
		t.Fatal("feb")
	}
}

func TestEstimateSSETokensContent(t *testing.T) {
	n := estimateSSETokens([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"abcdefghijklmnopqrstuvwxyz012345\"}}]}\n\n"))
	if n < 1 {
		t.Fatalf("est %d", n)
	}
}

func TestObserveConsumesRemainingAndGatesNext(t *testing.T) {
	b := NewMemoryBudget(NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)))
	a, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{OutputCap: 5, HasCap: true})
	if !ok {
		t.Fatal("A reserve")
	}
	b.Observe(a, 8)
	snap := b.Snap(1, "2026-01")
	if snap.Used != 8 || snap.Reserved != 0 || snap.Settled != 0 {
		t.Fatalf("after observe %+v", snap)
	}
	if _, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{OutputCap: 3, HasCap: true}); ok {
		t.Fatal("need=3 must reject")
	}
	if _, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{OutputCap: 2, HasCap: true}); !ok {
		t.Fatal("need=2 must pass")
	}
}

func TestObserveOverHardBlocksAll(t *testing.T) {
	b := NewMemoryBudget(NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)))
	a, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{OutputCap: 5, HasCap: true})
	if !ok {
		t.Fatal("reserve")
	}
	b.Observe(a, 20)
	snap := b.Snap(1, "2026-01")
	if snap.Used != 20 || snap.Reserved != 0 {
		t.Fatalf("over hard %+v", snap)
	}
	if _, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{OutputCap: 1, HasCap: true}); ok {
		t.Fatal("any positive need must reject")
	}
}

func TestObserveNonPositiveIgnored(t *testing.T) {
	b := NewMemoryBudget(NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)))
	lease, _ := b.Reserve(1, "2026-01", 10, ReserveSpec{OutputCap: 5, HasCap: true})
	b.Observe(lease, 3)
	b.Observe(lease, 0)
	b.Observe(lease, -4)
	snap := b.Snap(1, "2026-01")
	if snap.Used != 3 || snap.Reserved != 2 {
		t.Fatalf("non-positive mutated %+v", snap)
	}
}

func TestLargeInputRejected(t *testing.T) {
	b := NewMemoryBudget(NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)))
	if _, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{Input: 11, OutputCap: 1, HasCap: true}); ok {
		t.Fatal("input+cap exceeds")
	}
	if _, ok := b.Reserve(1, "2026-01", 10, ReserveSpec{Input: 11}); ok {
		t.Fatal("input exceeds remainder")
	}
}
