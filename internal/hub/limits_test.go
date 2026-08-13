package hub

import (
	"net/http"
	"sync"
	"testing"
	"time"

	"kodax-fabric/internal/store"
)

func TestBucketReconfigureClamps(t *testing.T) {
	clk := NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	l := NewLimiter(clk)
	for i := 0; i < 5; i++ {
		if !l.AllowVK(1, 60, 5) {
			t.Fatalf("take %d", i)
		}
	}
	if l.AllowVK(1, 60, 1) {
		t.Fatal("empty bucket with smaller burst must deny")
	}
	clk.Advance(time.Minute)
	if !l.AllowVK(1, 120, 2) {
		t.Fatal("new rate/burst should refill under new config")
	}
}

func TestStartStopProbes(t *testing.T) {
	s := New(&store.Memory{}, http.DefaultClient)
	s.StartProbes()
	s.StopProbes()
	s.StopProbes()
}

func TestLimiterConcurrentSafe(t *testing.T) {
	clk := NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	l := NewLimiter(clk)
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				l.AllowVK(1, 6000, 100)
				l.AllowProvider("p", 6000, 100)
				_ = l.AllowChannel(1, 1)
				l.Record(1, 1, time.Millisecond, j%3 != 0, j%5 == 0)
				l.Tick()
				_ = l.Snapshot()
			}
		}()
	}
	wg.Wait()
}
