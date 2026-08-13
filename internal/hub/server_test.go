package hub_test

import (
	"context"
	"encoding/json"
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

const testVK = "fab-test-key-1"

func openaiUsageBody() string {
	return `{"id":"chatcmpl-fixed","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"hello-fixed"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5},"tool_choice":"auto"}`
}

func newGateway(t *testing.T, channels []store.Channel) *httptest.Server {
	t.Helper()
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: channels},
	}}
	h := hub.New(st, http.DefaultClient)
	return httptest.NewServer(h.Handler())
}

func TestChatCompletionsPassThroughAndUsageAndRateLimit(t *testing.T) {
	const wantBody = `{"model":"gpt-4","messages":[{"role":"user","content":"x"}],"tool_choice":"auto"}`
	var gotUpstream []byte
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected upstream path %s", r.URL.Path)
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer sk-up-") {
			t.Errorf("upstream missing provider bearer")
		}
		if strings.Contains(r.Header.Get("Authorization"), testVK) {
			t.Errorf("caller vk leaked to upstream auth")
		}
		b, _ := io.ReadAll(r.Body)
		gotUpstream = b
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("x-ratelimit-remaining-requests", "42")
		w.Header().Set("x-ratelimit-limit-requests", "100")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)

	gw := newGateway(t, []store.Channel{{
		ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up-secret",
	}})
	t.Cleanup(gw.Close)

	req, err := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(wantBody))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+testVK)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if string(gotUpstream) != wantBody {
		t.Fatalf("upstream body mutated:\n got %s\nwant %s", gotUpstream, wantBody)
	}
	if resp.Header.Get("x-ratelimit-remaining-requests") != "42" {
		t.Fatalf("rate-limit header not passed: %q", resp.Header.Get("x-ratelimit-remaining-requests"))
	}
	raw, _ := io.ReadAll(resp.Body)
	if string(raw) != openaiUsageBody() {
		t.Fatalf("response not passed through:\n got %s", raw)
	}
	var parsed struct {
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		} `json:"usage"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Usage.PromptTokens != 3 || parsed.Usage.CompletionTokens != 2 || parsed.Usage.TotalTokens != 5 {
		t.Fatalf("usage mismatch: %+v", parsed.Usage)
	}
	if parsed.Choices[0].Message.Content != "hello-fixed" {
		t.Fatalf("content %q", parsed.Choices[0].Message.Content)
	}
	if strings.Contains(string(raw), "sk-up-secret") {
		t.Fatal("upstream secret leaked to caller")
	}
}

func TestChatCompletionsRotatesTwoProviderKeys(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-a"},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-b"},
	})
	t.Cleanup(gw.Close)

	body := `{"model":"gpt-4","messages":[{"role":"user","content":"x"}]}`
	for i := 0; i < 4; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+testVK)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("req %d status %d body %s", i, resp.StatusCode, raw)
		}
		if strings.Contains(string(raw), "sk-key-") {
			t.Fatal("upstream secret leaked to caller")
		}
	}
	want := []string{"sk-key-a", "sk-key-b", "sk-key-a", "sk-key-b"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("rotation got %v want %v", got, want)
	}
}

func TestDisabledProviderKeyNotSelected(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-a", Status: "disabled"},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-b", Status: "active"},
	})
	t.Cleanup(gw.Close)

	body := `{"model":"gpt-4","messages":[{"role":"user","content":"x"}]}`
	for i := 0; i < 3; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("req %d status %d", i, resp.StatusCode)
		}
	}
	for _, s := range got {
		if s == "sk-key-a" {
			t.Fatalf("disabled key was used: %v", got)
		}
	}
	if len(got) != 3 {
		t.Fatalf("hits %v", got)
	}
}

func TestAllDisabledKeysReturn503NoCrossProtocol(t *testing.T) {
	var otherHits int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&otherHits, 1)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(other.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: "http://127.0.0.1:1", Secret: "sk-key-a", Status: "disabled"},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: "http://127.0.0.1:1", Secret: "sk-key-b", Status: "disabled"},
		{ID: 3, Protocol: store.ProtocolAnthropic, BaseURL: other.URL, Secret: "sk-anth", Status: "active"},
	})
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 503 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&otherHits) != 0 {
		t.Fatal("fell through to Anthropic channel")
	}
}

func TestUpstream401DisablesProviderKey(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		got = append(got, key)
		if key == "sk-key-a" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-a"},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-b"},
	})
	t.Cleanup(gw.Close)

	body := `{"model":"gpt-4","messages":[{"role":"user","content":"x"}]}`
	for i := 0; i < 3; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if i == 0 && resp.StatusCode != 401 {
			t.Fatalf("first status %d", resp.StatusCode)
		}
		if i > 0 && resp.StatusCode != 200 {
			t.Fatalf("req %d status %d", i, resp.StatusCode)
		}
	}
	if got[0] != "sk-key-a" {
		t.Fatalf("first hit %v", got)
	}
	for i, k := range got[1:] {
		if k == "sk-key-a" {
			t.Fatalf("key A used after 401 at later hit %d: %v", i+1, got)
		}
	}
}

func TestUpstream403DisablesProviderKey(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		got = append(got, key)
		if key == "sk-key-a" {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":{"message":"quota"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-a"},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-b"},
	})
	t.Cleanup(gw.Close)

	body := `{"model":"gpt-4","messages":[{"role":"user","content":"x"}]}`
	for i := 0; i < 3; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
	for _, k := range got[1:] {
		if k == "sk-key-a" {
			t.Fatalf("key A used after 403: %v", got)
		}
	}
}

func TestUpstream5xxDoesNotDisableProviderKey(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		got = append(got, key)
		if key == "sk-key-a" {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":"upstream"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-a"},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-key-b"},
	})
	t.Cleanup(gw.Close)

	body := `{"model":"gpt-4","messages":[{"role":"user","content":"x"}]}`
	for i := 0; i < 4; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
	want := []string{"sk-key-a", "sk-key-b", "sk-key-a", "sk-key-b"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("5xx should not drop key A: got %v want %v", got, want)
	}
}

func TestChatCompletionsInvalidKey401(t *testing.T) {
	gw := newGateway(t, []store.Channel{{
		ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: "http://127.0.0.1:1", Secret: "sk-up",
	}})
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"x"}`))
	req.Header.Set("Authorization", "Bearer fab-wrong")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	var env struct {
		Error struct {
			Code string `json:"code"`
			Type string `json:"type"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatal(err)
	}
	if env.Error.Code != "invalid_api_key" {
		t.Fatalf("envelope %+v body %s", env, raw)
	}
}

func TestSameVKBothEndpoints(t *testing.T) {
	const oaiBody = `{"model":"gpt-4","messages":[{"role":"user","content":"x"}]}`
	const anthBody = `{"model":"claude-3","messages":[{"role":"user","content":"hi"}]}`
	var oaiHits, anthHits int32
	oai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("openai path %s", r.URL.Path)
		}
		atomic.AddInt32(&oaiHits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(oai.Close)
	anth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("anthropic path %s", r.URL.Path)
		}
		atomic.AddInt32(&anthHits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}]}`))
	}))
	t.Cleanup(anth.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: oai.URL, Secret: "sk-oai"},
		{ID: 2, Protocol: store.ProtocolAnthropic, BaseURL: anth.URL, Secret: "sk-anth"},
	})
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(oaiBody))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("chat status %d", resp.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(anthBody))
	req.Header.Set("X-Api-Key", testVK)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("messages status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&oaiHits) != 1 || atomic.LoadInt32(&anthHits) != 1 {
		t.Fatalf("hits oai=%d anth=%d", oaiHits, anthHits)
	}
}

func TestMessagesPassThroughSameVK(t *testing.T) {
	const want = `{"model":"claude-3","messages":[{"role":"user","content":"hi"}],"thinking":{"type":"enabled"}}`
	const upResp = `{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"ok-fixed"}],"usage":{"input_tokens":4,"output_tokens":1}}`
	var got []byte
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path %s", r.URL.Path)
		}
		if r.Header.Get("X-Api-Key") != "sk-anth-up" {
			t.Errorf("missing anthropic key")
		}
		got, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(upResp))
	}))
	t.Cleanup(up.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: "http://127.0.0.1:1", Secret: "sk-oai"},
		{ID: 2, Protocol: store.ProtocolAnthropic, BaseURL: up.URL, Secret: "sk-anth-up"},
	})
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(want))
	req.Header.Set("X-Api-Key", testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if string(got) != want {
		t.Fatalf("mutated body %s", got)
	}
	raw, _ := io.ReadAll(resp.Body)
	if string(raw) != upResp {
		t.Fatalf("resp %s", raw)
	}
}

func TestMessagesRotatesTwoProviderKeys(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path %s", r.URL.Path)
		}
		got = append(got, r.Header.Get("X-Api-Key"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}]}`))
	}))
	t.Cleanup(up.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: "http://127.0.0.1:1", Secret: "sk-oai"},
		{ID: 2, Protocol: store.ProtocolAnthropic, BaseURL: up.URL, Secret: "sk-anth-a"},
		{ID: 3, Protocol: store.ProtocolAnthropic, BaseURL: up.URL, Secret: "sk-anth-b"},
	})
	t.Cleanup(gw.Close)

	body := `{"model":"claude-3","messages":[{"role":"user","content":"hi"}]}`
	for i := 0; i < 4; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(body))
		req.Header.Set("X-Api-Key", testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("req %d status %d body %s", i, resp.StatusCode, raw)
		}
	}
	want := []string{"sk-anth-a", "sk-anth-b", "sk-anth-a", "sk-anth-b"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("rotation got %v want %v", got, want)
	}
}

func TestMessagesNoCrossProtocolFallback(t *testing.T) {
	var openaiHits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&openaiHits, 1)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(up.Close)

	gw := newGateway(t, []store.Channel{{
		ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-oai",
	}})
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(`{"model":"claude"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 503 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&openaiHits) != 0 {
		t.Fatal("fell through to OpenAI channel")
	}
	raw, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(raw), "no matching channel") {
		t.Fatalf("body %s", raw)
	}
}

func TestSSEChatCompletionsChunks(t *testing.T) {
	chunks := []string{
		"data: {\"choices\":[{\"delta\":{\"content\":\"hel\"},\"thinking\":\"t1\"}]}\n\n",
		"data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n",
		"data: [DONE]\n\n",
	}
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		for _, c := range chunks {
			_, _ = io.WriteString(w, c)
			fl.Flush()
		}
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{{
		ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up",
	}})
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","stream":true}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	got := string(raw)
	if !strings.Contains(got, "hel") || !strings.Contains(got, "lo") || !strings.Contains(got, "[DONE]") {
		t.Fatalf("missing chunks: %s", got)
	}
	if !strings.Contains(got, `"thinking":"t1"`) {
		t.Fatalf("thinking stripped: %s", got)
	}
}

func TestSSEMessagesChunks(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "event: content_block_delta\ndata: {\"delta\":{\"text\":\"ab\"}}\n\n")
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{{
		ID: 1, Protocol: store.ProtocolAnthropic, BaseURL: up.URL, Secret: "sk-a",
	}})
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(`{"model":"claude","stream":true}`))
	req.Header.Set("X-Api-Key", testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(raw), `"text":"ab"`) {
		t.Fatalf("body %s", raw)
	}
}

func TestClientDisconnectCancelsUpstream(t *testing.T) {
	var cancelled atomic.Bool
	started := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n")
		fl.Flush()
		close(started)
		select {
		case <-r.Context().Done():
			cancelled.Store(true)
		case <-time.After(8 * time.Second):
		}
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{{
		ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up",
	}})
	t.Cleanup(gw.Close)

	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","stream":true}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	<-started
	buf := make([]byte, 1)
	_, _ = resp.Body.Read(buf)
	cancel()
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cancelled.Load() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("upstream was not cancelled")
}

func TestHealth(t *testing.T) {
	gw := newGateway(t, nil)
	t.Cleanup(gw.Close)
	resp, err := http.Get(gw.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(raw), `"ok":true`) {
		t.Fatalf("health %s", raw)
	}
}
