package fabric_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestMessagesAcceptsAnthropicXAPIKey(t *testing.T) {
	srv := newTestServer(t)
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/messages", bytes.NewReader([]byte(`{"model":"claude-haiku-4","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}`)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("x-api-key", fabric.SeedVirtualKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d: %s", resp.StatusCode, b)
	}
}

func TestMessagesReturnsAnthropicFixture(t *testing.T) {
	srv := newTestServer(t)
	status, body := postMessages(t, srv, fabric.SeedVirtualKey, `{"model":"claude-haiku-4","max_tokens":32,"messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	want := readFixture(t, "anthropic/message.json")
	var gotJSON, wantJSON any
	if err := json.Unmarshal(body, &gotJSON); err != nil {
		t.Fatalf("not json: %s", body)
	}
	if err := json.Unmarshal(want, &wantJSON); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(gotJSON, wantJSON) {
		t.Fatalf("body != fixture\ngot %s\nwant %s", body, want)
	}

	admin := loginAdmin(t, srv)
	listed := listRequests(t, admin, srv.URL)
	if len(listed) != 1 {
		t.Fatalf("requests %+v", listed)
	}
	row := listed[0]
	if row.InputTokens != 8 || row.OutputTokens != 12 || row.CostCNY != 0.000032 {
		t.Fatalf("usage %+v", row)
	}
}

func TestMessagesStreamMatchesFixture(t *testing.T) {
	srv := newTestServer(t)
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/messages", bytes.NewReader([]byte(`{"model":"claude-haiku-4","max_tokens":32,"stream":true,"messages":[{"role":"user","content":"hi"}]}`)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+fabric.SeedVirtualKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	got, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	want := readFixture(t, "anthropic/message.sse")
	if !bytes.Equal(got, want) {
		t.Fatalf("sse != fixture\ngot:\n%s\nwant:\n%s", got, want)
	}
	admin := loginAdmin(t, srv)
	listed := listRequests(t, admin, srv.URL)
	if len(listed) != 1 || listed[0].InputTokens != 8 || listed[0].OutputTokens != 12 {
		t.Fatalf("stream usage %+v", listed)
	}
}

func TestMessagesDisconnectCancelsUpstream(t *testing.T) {
	srv := newTestServer(t)
	srv.provider.ChunkDelay = 80 * time.Millisecond
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/messages", bytes.NewReader([]byte(`{"model":"claude-haiku-4","stream":true,"max_tokens":8,"messages":[{"role":"user","content":"hi"}]}`)))
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
	buf := make([]byte, 32)
	if _, err := resp.Body.Read(buf); err != nil && err != io.EOF {
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
	time.Sleep(50 * time.Millisecond)
	admin := loginAdmin(t, srv)
	if listed := listRequests(t, admin, srv.URL); len(listed) != 1 {
		t.Fatalf("want request after disconnect, got %+v", listed)
	}
}

func TestOpenAIEndpointRejectsAnthropicModelWithoutCallingProvider(t *testing.T) {
	srv := newTestServer(t)
	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"claude-haiku-4","messages":[]}`)
	if status != http.StatusBadRequest {
		t.Fatalf("status %d", status)
	}
	if srv.ProviderCalls() != 0 {
		t.Fatalf("provider called %d", srv.ProviderCalls())
	}
}

func TestAnthropicUnopenedPathRejected(t *testing.T) {
	srv := newTestServer(t)
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/messages/count_tokens", bytes.NewReader([]byte(`{"model":"claude-haiku-4"}`)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+fabric.SeedVirtualKey)
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if srv.ProviderCalls() != 0 {
		t.Fatalf("provider called %d", srv.ProviderCalls())
	}
}

func postMessages(t *testing.T, srv *httptestServer, vk, raw string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/messages", bytes.NewReader([]byte(raw)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+vk)
	req.Header.Set("Content-Type", "application/json")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, body
}
