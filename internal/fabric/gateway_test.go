package fabric_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestValidVirtualKeyReturnsFixtureCompletion(t *testing.T) {
	srv := newTestServer(t)
	client := srv.Client()

	reqBody := []byte(`{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader(reqBody))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+fabric.SeedVirtualKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d: %s", resp.StatusCode, body)
	}

	got, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	want := readFixture(t, "openai/chat_completion.json")
	var gotJSON, wantJSON any
	if err := json.Unmarshal(got, &gotJSON); err != nil {
		t.Fatalf("response is not JSON: %v\n%s", err, got)
	}
	if err := json.Unmarshal(want, &wantJSON); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(gotJSON, wantJSON) {
		t.Fatalf("response body != fixture\ngot:  %s\nwant: %s", got, want)
	}
}

func TestUnknownModelIsRejectedWithoutCallingProvider(t *testing.T) {
	srv := newTestServer(t)
	status, body := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"not-a-model","messages":[]}`)
	if status != http.StatusBadRequest {
		t.Fatalf("status %d: %s", status, body)
	}
	if srv.ProviderCalls() != 0 {
		t.Fatalf("provider called %d times", srv.ProviderCalls())
	}
}

func TestMissingVirtualKeyIsRejectedWithoutCallingProvider(t *testing.T) {
	srv := newTestServer(t)
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader([]byte(`{"model":"gpt-4o-mini"}`)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if srv.ProviderCalls() != 0 {
		t.Fatalf("provider called %d times", srv.ProviderCalls())
	}
}

func TestWrongVirtualKeyIsRejectedWithoutCallingProvider(t *testing.T) {
	srv := newTestServer(t)
	status, _ := postChat(t, srv, "sk-wrong", `{"model":"gpt-4o-mini","messages":[]}`)
	if status != http.StatusUnauthorized {
		t.Fatalf("status %d", status)
	}
	if srv.ProviderCalls() != 0 {
		t.Fatalf("provider called %d times", srv.ProviderCalls())
	}
}

func TestUnopenedPathIsRejectedWithoutCallingProvider(t *testing.T) {
	srv := newTestServer(t)
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/embeddings", bytes.NewReader([]byte(`{"model":"gpt-4o-mini"}`)))
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
		t.Fatalf("provider called %d times", srv.ProviderCalls())
	}
}

func TestCompletionAppendsRequestVisibleOnUsageReport(t *testing.T) {
	srv := newTestServer(t)
	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("chat status %d", status)
	}

	admin := loginAdmin(t, srv)
	resp, err := admin.Get(srv.URL + "/admin/api/usage?project=demo&day=2026-08-17")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("usage %d: %s", resp.StatusCode, body)
	}
	var payload struct {
		Project string `json:"project"`
		Day     string `json:"day"`
		Rows    []struct {
			Model        string  `json:"model"`
			InputTokens  int     `json:"input_tokens"`
			OutputTokens int     `json:"output_tokens"`
			CostCNY      float64 `json:"cost_cny"`
		} `json:"rows"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Project != "demo" || payload.Day != "2026-08-17" {
		t.Fatalf("got project=%s day=%s", payload.Project, payload.Day)
	}
	if len(payload.Rows) != 1 {
		t.Fatalf("rows: %+v", payload.Rows)
	}
	row := payload.Rows[0]
	if row.Model != "gpt-4o-mini" || row.InputTokens != 10 || row.OutputTokens != 20 {
		t.Fatalf("row: %+v", row)
	}
	// 10/1e6 * 1.0 + 20/1e6 * 2.0 = 0.00005
	if row.CostCNY != 0.00005 {
		t.Fatalf("cost %v, want 0.00005", row.CostCNY)
	}

	reqList, err := admin.Get(srv.URL + "/admin/api/requests?project=demo")
	if err != nil {
		t.Fatal(err)
	}
	defer reqList.Body.Close()
	var listed struct {
		Requests []struct {
			VirtualKeyHash string  `json:"virtual_key_hash"`
			Project        string  `json:"project"`
			Model          string  `json:"model"`
			InputTokens    int     `json:"input_tokens"`
			OutputTokens   int     `json:"output_tokens"`
			CostCNY        float64 `json:"cost_cny"`
			Status         int     `json:"status"`
		} `json:"requests"`
	}
	if err := json.NewDecoder(reqList.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Requests) != 1 {
		t.Fatalf("requests: %+v", listed.Requests)
	}
	got := listed.Requests[0]
	if got.VirtualKeyHash != fabric.HashVirtualKey(fabric.SeedVirtualKey) ||
		got.Project != "demo" || got.Model != "gpt-4o-mini" ||
		got.InputTokens != 10 || got.OutputTokens != 20 ||
		got.Status != http.StatusOK || got.CostCNY != 0.00005 {
		t.Fatalf("request row: %+v", got)
	}
}

func TestAdminPageIsServed(t *testing.T) {
	srv := newTestServer(t)
	resp, err := srv.Client().Get(srv.URL + "/admin")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if !bytes.Contains(body, []byte("KodaX")) && !bytes.Contains(body, []byte("管理")) && !bytes.Contains(body, []byte("root")) {
		t.Fatalf("admin spa missing: %s", body)
	}
}

func postChat(t *testing.T, srv *httptestServer, vk, raw string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader([]byte(raw)))
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

func jsonEqual(a, b any) bool {
	ab, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return bytes.Equal(ab, bb)
}

func readFixture(t *testing.T, rel string) []byte {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	path := filepath.Join(filepath.Dir(file), "..", "..", "testdata", "fixtures", rel)
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func newTestServer(t *testing.T) *httptestServer {
	t.Helper()
	fixture := readFixture(t, "openai/chat_completion.json")
	provider := &fabric.FixtureProvider{
		Body:               fixture,
		StreamBody:         readFixture(t, "openai/chat_completion.sse"),
		MessagesBody:       readFixture(t, "anthropic/message.json"),
		MessagesStreamBody: readFixture(t, "anthropic/message.sse"),
	}
	store := fabric.NewSeededMemoryStore(fabric.HashAdminPassword(fabric.SeedAdminPass))
	app := fabric.NewServer(store, provider)
	app.Now = func() time.Time {
		loc := time.FixedZone("CST", 8*3600)
		return time.Date(2026, 8, 17, 15, 0, 0, 0, loc)
	}
	hs := httptest.NewServer(app.Handler())
	t.Cleanup(hs.Close)
	return &httptestServer{URL: hs.URL, provider: provider, app: app, Client: func() *http.Client {
		return hs.Client()
	}}
}

type httptestServer struct {
	URL      string
	provider *fabric.FixtureProvider
	app      *fabric.Server
	Client   func() *http.Client
}

func (s *httptestServer) ProviderCalls() int {
	return s.provider.Calls()
}

func loginAdmin(t *testing.T, srv *httptestServer) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}
	body := []byte(`{"username":"` + fabric.SeedAdminUser + `","password":"` + fabric.SeedAdminPass + `"}`)
	resp, err := client.Post(srv.URL+"/admin/api/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("login %d: %s", resp.StatusCode, b)
	}
	return client
}
