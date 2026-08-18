package fabric_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestFailoverOn500ReturnsSecondChannelAndOneRequest(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	setupTwoChannels(t, admin, srv.URL, "fail-over")
	success := readFixture(t, "openai/chat_completion.json")
	srv.provider.Steps = []fabric.FixtureStep{
		{Status: http.StatusInternalServerError, Body: []byte(`{"error":"up","usage":{"prompt_tokens":10,"completion_tokens":5}}`)},
		{Status: http.StatusOK, Body: success},
	}

	status, body := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"fail-over","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	if !strings.Contains(string(body), "hello from fixture") {
		t.Fatalf("caller should see last success: %s", body)
	}
	if strings.Contains(string(body), "channel") || strings.Contains(string(body), `"ch-`) {
		t.Fatalf("caller saw channel: %s", body)
	}
	if srv.ProviderCalls() != 2 {
		t.Fatalf("attempts %d", srv.ProviderCalls())
	}

	rows := waitRequestViews(t, admin, srv.URL, "demo")
	if len(rows) != 1 {
		t.Fatalf("requests %+v", rows)
	}
	row := rows[0]
	if row.InputTokens != 10 || row.OutputTokens != 20 {
		t.Fatalf("usage from last attempt %+v", row)
	}
	// fail 10/5 at 1/2 per million + success 10/20 at 1/2 = 0.00002 + 0.00005
	if delta := row.CostCNY - 0.00007; delta > 1e-12 || delta < -1e-12 {
		t.Fatalf("cost %v", row.CostCNY)
	}
	if len(row.Attempts) != 2 {
		t.Fatalf("attempts %+v", row.Attempts)
	}
	if row.Attempts[0].Status != 500 || row.Attempts[0].SeenByCaller || row.Attempts[0].InputTokens != 10 || row.Attempts[0].OutputTokens != 5 {
		t.Fatalf("first attempt %+v", row.Attempts[0])
	}
	if row.Attempts[1].Status != 200 || !row.Attempts[1].SeenByCaller || row.Attempts[1].InputTokens != 10 || row.Attempts[1].OutputTokens != 20 {
		t.Fatalf("last attempt %+v", row.Attempts[1])
	}
	if row.Attempts[0].ChannelID == "" || row.Attempts[1].ChannelID == "" {
		t.Fatalf("snapshot missing channel %+v", row.Attempts)
	}
}

func TestBadRequestDoesNotFailover(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	setupTwoChannels(t, admin, srv.URL, "no-swap")
	srv.provider.Steps = []fabric.FixtureStep{
		{Status: http.StatusBadRequest, Body: []byte(`{"error":"bad_request"}`)},
		{Status: http.StatusOK, Body: readFixture(t, "openai/chat_completion.json")},
	}

	status, body := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"no-swap","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusBadRequest {
		t.Fatalf("status %d: %s", status, body)
	}
	if !strings.Contains(string(body), "bad_request") {
		t.Fatalf("body %s", body)
	}
	if srv.ProviderCalls() != 1 {
		t.Fatalf("calls %d", srv.ProviderCalls())
	}
}

func TestStreamDoesNotFailoverAfterWrite(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	setupTwoChannels(t, admin, srv.URL, "stream-once")
	srv.provider.Steps = []fabric.FixtureStep{
		{Status: http.StatusOK, StreamBody: readFixture(t, "openai/chat_completion.sse")},
		{Status: http.StatusOK, StreamBody: []byte("data: should-not-appear\n\n")},
	}

	resp := postStream(t, srv, fabric.SeedVirtualKey, []byte(`{"model":"stream-once","stream":true,"messages":[{"role":"user","content":"hi"}]}`))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d: %s", resp.StatusCode, b)
	}
	got, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(got), "should-not-appear") {
		t.Fatalf("stream mixed two channels: %s", got)
	}
	if srv.ProviderCalls() != 1 {
		t.Fatalf("calls %d", srv.ProviderCalls())
	}
}

type attemptView struct {
	ChannelID    string  `json:"channel_id"`
	Status       int     `json:"status"`
	InputTokens  int     `json:"input_tokens"`
	OutputTokens int     `json:"output_tokens"`
	CostCNY      float64 `json:"cost_cny"`
	SeenByCaller bool    `json:"seen_by_caller"`
}

type requestWithAttempts struct {
	InputTokens  int           `json:"input_tokens"`
	OutputTokens int           `json:"output_tokens"`
	CostCNY      float64       `json:"cost_cny"`
	Status       int           `json:"status"`
	Attempts     []attemptView `json:"attempts"`
}

func setupTwoChannels(t *testing.T, admin *http.Client, base, model string) {
	t.Helper()
	createProvider(t, admin, base, model+"-p", "openai", "https://example.invalid", "sk-a")
	keys := listProviderKeys(t, admin, base, model+"-p")
	k2 := createProviderKey(t, admin, base, model+"-p", "sk-b")
	createModel(t, admin, base, model, "openai", model+"-p")
	createChannel(t, admin, base, model, keys[0].ID, 1, 10, 1, 2, 0.1)
	createChannel(t, admin, base, model, k2.ID, 1, 1, 1, 2, 0.1)
}

func waitRequestViews(t *testing.T, admin *http.Client, base, team string) []requestWithAttempts {
	t.Helper()
	_ = listRequests(t, admin, base)
	resp, err := admin.Get(base + "/admin/api/requests?project=" + team)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Requests []requestWithAttempts `json:"requests"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	return payload.Requests
}
