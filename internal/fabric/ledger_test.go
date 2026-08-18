package fabric_test

import (
	"context"
	"io"
	"net/http"
	"sort"
	"testing"
	"time"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestRequestLedgerRecordsLatencyAndCreatedAt(t *testing.T) {
	srv := newTestServer(t)
	srv.provider.Delay = 40 * time.Millisecond

	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}

	admin := loginAdmin(t, srv)
	listed := listRequests(t, admin, srv.URL)
	if len(listed) != 1 {
		t.Fatalf("requests %+v", listed)
	}
	row := listed[0]
	if row.CreatedAt != "2026-08-17T15:00:00+08:00" {
		t.Fatalf("created_at %q", row.CreatedAt)
	}
	if row.LatencyMS < 40 {
		t.Fatalf("latency_ms %d want >= 40", row.LatencyMS)
	}
	if row.LatencyMS > 500 {
		t.Fatalf("latency_ms %d looks like wall-clock leak", row.LatencyMS)
	}
}

func TestMeteringDoesNotBlockCallerResponse(t *testing.T) {
	srv := newTestServer(t)
	srv.store.AppendDelay = 200 * time.Millisecond

	start := time.Now()
	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	elapsed := time.Since(start)
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	if elapsed >= 150*time.Millisecond {
		t.Fatalf("response waited for ledger write: %v", elapsed)
	}

	admin := loginAdmin(t, srv)
	listed := listRequests(t, admin, srv.URL)
	if len(listed) != 1 {
		t.Fatalf("request never appeared: %+v", listed)
	}
}

func TestGatewayNonStreamOverheadP99Under50ms(t *testing.T) {
	srv := newTestServer(t)
	const n = 40
	samples := make([]time.Duration, 0, n)
	for i := 0; i < n; i++ {
		start := time.Now()
		status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
		if status != http.StatusOK {
			t.Fatalf("status %d", status)
		}
		samples = append(samples, time.Since(start))
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	p99 := samples[(n*99)/100]
	if p99 >= 50*time.Millisecond {
		t.Fatalf("p99 %v want < 50ms (max %v)", p99, samples[n-1])
	}
}

type failProvider struct{}

func (failProvider) ChatCompletions(context.Context, []byte) (int, map[string]string, io.ReadCloser, error) {
	return 0, nil, nil, io.EOF
}

func (failProvider) Messages(context.Context, []byte) (int, map[string]string, io.ReadCloser, error) {
	return 0, nil, nil, io.EOF
}

func TestProviderErrorStillRecordsRequest(t *testing.T) {
	srv := newTestServer(t)
	srv.app.Provider = failProvider{}

	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusBadGateway {
		t.Fatalf("status %d", status)
	}
	admin := loginAdmin(t, srv)
	listed := listRequests(t, admin, srv.URL)
	if len(listed) != 1 || listed[0].Status != http.StatusBadGateway {
		t.Fatalf("requests %+v", listed)
	}
}
