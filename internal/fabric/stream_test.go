package fabric_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"testing"
	"time"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestStreamedCompletionMatchesFixtureSSE(t *testing.T) {
	srv := newTestServer(t)
	resp := postStream(t, srv, fabric.SeedVirtualKey, streamBody())
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d: %s", resp.StatusCode, b)
	}
	got, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	want := readFixture(t, "openai/chat_completion.sse")
	if !bytes.Equal(got, want) {
		t.Fatalf("sse != fixture\ngot:\n%s\nwant:\n%s", got, want)
	}

	admin := loginAdmin(t, srv)
	listed := listRequests(t, admin, srv.URL)
	if len(listed) != 1 {
		t.Fatalf("requests %+v", listed)
	}
	row := listed[0]
	if row.InputTokens != 10 || row.OutputTokens != 20 || row.CostCNY != 0.00005 || row.Status != http.StatusOK {
		t.Fatalf("request %+v", row)
	}
}

func TestStreamDoesNotBufferEntireResponse(t *testing.T) {
	srv := newTestServer(t)
	srv.provider.ChunkDelay = 40 * time.Millisecond
	start := time.Now()
	resp := postStream(t, srv, fabric.SeedVirtualKey, streamBody())
	defer resp.Body.Close()
	buf := make([]byte, 16)
	if _, err := resp.Body.Read(buf); err != nil {
		t.Fatal(err)
	}
	first := time.Since(start)
	if first > 70*time.Millisecond {
		t.Fatalf("first byte after %v; response was buffered", first)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
}

func TestClientDisconnectAfterUsageChunkRecordsTokens(t *testing.T) {
	srv := newTestServer(t)
	srv.provider.StreamBody = []byte("data: {\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":20,\"total_tokens\":30}}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\ndata: [DONE]\n\n")
	srv.provider.ChunkDelay = 80 * time.Millisecond

	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader(streamBody()))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+fabric.SeedVirtualKey)
	req.Header.Set("Content-Type", "application/json")
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 96)
	if _, err := resp.Body.Read(buf); err != nil && err != io.EOF {
		t.Fatal(err)
	}
	cancel()
	_ = resp.Body.Close()
	time.Sleep(50 * time.Millisecond)

	admin := loginAdmin(t, srv)
	listed := listRequests(t, admin, srv.URL)
	if len(listed) != 1 {
		t.Fatalf("requests %+v", listed)
	}
	if listed[0].InputTokens != 10 || listed[0].OutputTokens != 20 {
		t.Fatalf("usage after disconnect %+v", listed[0])
	}
}

func TestClientDisconnectCancelsUpstreamAndStillRecordsRequest(t *testing.T) {
	srv := newTestServer(t)
	srv.provider.ChunkDelay = 80 * time.Millisecond

	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader(streamBody()))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+fabric.SeedVirtualKey)
	req.Header.Set("Content-Type", "application/json")
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)

	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(resp.Body)
	if _, err := reader.ReadBytes('\n'); err != nil {
		t.Fatal(err)
	}
	cancel()
	_ = resp.Body.Close()

	deadline := time.Now().Add(400 * time.Millisecond)
	for time.Now().Before(deadline) {
		if srv.provider.Cancelled() {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !srv.provider.Cancelled() {
		t.Fatal("upstream was not cancelled")
	}
	if n := srv.provider.ChunksEmitted(); n >= 4 {
		t.Fatalf("emitted all %d chunks after disconnect", n)
	}

	// let append finish
	time.Sleep(50 * time.Millisecond)
	admin := loginAdmin(t, srv)
	listed := listRequests(t, admin, srv.URL)
	if len(listed) != 1 {
		t.Fatalf("want 1 request, got %+v", listed)
	}
	if listed[0].InputTokens != 0 || listed[0].OutputTokens != 0 {
		t.Fatalf("disconnect before usage should record zeros: %+v", listed[0])
	}
	if listed[0].Status == 0 {
		t.Fatalf("status should be recorded: %+v", listed[0])
	}
}

func TestGatewayStreamOverheadP99Under50ms(t *testing.T) {
	srv := newTestServer(t)
	const n = 40
	samples := make([]time.Duration, 0, n)
	for i := 0; i < n; i++ {
		start := time.Now()
		resp := postStream(t, srv, fabric.SeedVirtualKey, streamBody())
		if _, err := io.Copy(io.Discard, resp.Body); err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		samples = append(samples, time.Since(start))
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	p99 := samples[(n*99)/100]
	if p99 >= 50*time.Millisecond {
		t.Fatalf("p99 %v want < 50ms (max %v)", p99, samples[n-1])
	}
}

func streamBody() []byte {
	return []byte(`{"model":"gpt-4o-mini","stream":true,"messages":[{"role":"user","content":"hi"}]}`)
}

func postStream(t *testing.T, srv *httptestServer, vk string, raw []byte) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+vk)
	req.Header.Set("Content-Type", "application/json")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func listRequests(t *testing.T, admin *http.Client, base string) []struct {
	InputTokens  int     `json:"input_tokens"`
	OutputTokens int     `json:"output_tokens"`
	CostCNY      float64 `json:"cost_cny"`
	Status       int     `json:"status"`
} {
	t.Helper()
	resp, err := admin.Get(base + "/admin/api/requests?project=demo")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Requests []struct {
			InputTokens  int     `json:"input_tokens"`
			OutputTokens int     `json:"output_tokens"`
			CostCNY      float64 `json:"cost_cny"`
			Status       int     `json:"status"`
		} `json:"requests"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	return payload.Requests
}
