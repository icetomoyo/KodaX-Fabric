package hub_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
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
	aHits := 0
	for _, k := range got {
		if k == "sk-key-a" {
			aHits++
		}
	}
	if aHits < 2 {
		t.Fatalf("5xx should not disable key A: got %v", got)
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

func TestSameVKBothEndpoints(t *testing.T) {
	var chatHits, msgHits int32
	chatUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&chatHits, 1)
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(chatUp.Close)
	msgUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&msgHits, 1)
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message"}`))
	}))
	t.Cleanup(msgUp.Close)

	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: chatUp.URL, Secret: "sk-oai"},
		{ID: 2, Protocol: store.ProtocolAnthropic, BaseURL: msgUp.URL, Secret: "sk-anth"},
	})
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("chat status %d", resp.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(`{"model":"claude","messages":[]}`))
	req.Header.Set("X-Api-Key", testVK)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("messages status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&chatHits) != 1 || atomic.LoadInt32(&msgHits) != 1 {
		t.Fatalf("hits chat=%d msg=%d", chatHits, msgHits)
	}
}

func TestExpiredVKUnauthorized(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
	}))
	t.Cleanup(up.Close)
	expired := time.Now().Add(-time.Hour)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {
			VirtualKeyID: 1, PoolID: 1, ExpiresAt: &expired,
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
		},
	}}
	gw := httptest.NewServer(hub.New(st, http.DefaultClient).Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatal("expired VK still hit upstream")
	}
}

func TestModelNotInScopeForbidden(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {
			VirtualKeyID: 1, PoolID: 1, ModelScope: []string{"deepseek-chat"},
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
		},
	}}
	gw := httptest.NewServer(hub.New(st, http.DefaultClient).Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(raw), "model not allowed") {
		t.Fatalf("body %s", raw)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatal("out-of-scope model hit upstream")
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"deepseek-chat","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("allowed model status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("allowed model hits %d", hits)
	}
}

func TestModelScopeMissingModelForbidden(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {
			VirtualKeyID: 1, PoolID: 1, ModelScope: []string{"deepseek-chat"},
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
		},
	}}
	gw := httptest.NewServer(hub.New(st, http.DefaultClient).Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(raw), "model not allowed") {
		t.Fatalf("body %s", raw)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatal("missing model hit upstream")
	}
}

func TestPrimary5xxFailsOverToBackup(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		got = append(got, key)
		if key == "sk-primary" {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":"down"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-primary", Priority: 1},
			{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-backup", Priority: 2},
		}},
	}}
	gw := httptest.NewServer(hub.New(st, http.DefaultClient).Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if strings.Join(got, ",") != "sk-primary,sk-backup" {
		t.Fatalf("hits %v", got)
	}
	if resp.Header.Get("X-Fabric-Channel-Id") != "2" {
		t.Fatalf("channel %s", resp.Header.Get("X-Fabric-Channel-Id"))
	}
	if resp.Header.Get("X-Fabric-Route-Reason") != "failover" {
		t.Fatalf("reason %s", resp.Header.Get("X-Fabric-Route-Reason"))
	}
	if resp.Header.Get("X-Fabric-Tried") != "1,2" {
		t.Fatalf("tried %s", resp.Header.Get("X-Fabric-Tried"))
	}
	dec, err := st.RecentRoutes(req.Context(), 1)
	if err != nil || len(dec) != 1 {
		t.Fatalf("routes %v %v", dec, err)
	}
	if dec[0].ChannelID != 2 || dec[0].Reason != "failover" || !dec[0].Fallback || dec[0].Status != 200 {
		t.Fatalf("decision %+v", dec[0])
	}
	if len(dec[0].Tried) != 2 || dec[0].Tried[0] != 1 || dec[0].Tried[1] != 2 {
		t.Fatalf("tried %+v", dec[0].Tried)
	}
}

func Test400DoesNotRetry(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"bad"}`))
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-a", Priority: 1},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-b", Priority: 2},
	})
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if strings.Join(got, ",") != "sk-a" {
		t.Fatalf("retried 400: %v", got)
	}
}

func TestWeightedSamePriority(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-a", Weight: 3},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-b", Weight: 1},
	})
	t.Cleanup(gw.Close)
	body := `{"model":"gpt-4","messages":[]}`
	for i := 0; i < 4; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("status %d", resp.StatusCode)
		}
		if i == 0 && resp.Header.Get("X-Fabric-Route-Reason") != "weighted" {
			t.Fatalf("reason %s", resp.Header.Get("X-Fabric-Route-Reason"))
		}
	}
	if strings.Join(got, ",") != "sk-a,sk-a,sk-a,sk-b" {
		t.Fatalf("weights %v", got)
	}
}

func TestNoCrossProtocolOnFailover(t *testing.T) {
	var anthHits int32
	oai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"down"}`))
	}))
	t.Cleanup(oai.Close)
	anth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&anthHits, 1)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(anth.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: oai.URL, Secret: "sk-oai"},
		{ID: 2, Protocol: store.ProtocolAnthropic, BaseURL: anth.URL, Secret: "sk-anth"},
	})
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 502 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&anthHits) != 0 {
		t.Fatal("cross-protocol fallback")
	}
}

func TestModelAliasFallback(t *testing.T) {
	var gotModel string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var m struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(raw, &m)
		gotModel = m.Model
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{
		ByRawKey: map[string]*store.ResolvedVK{
			testVK: {
				VirtualKeyID: 1, PoolID: 1,
				Channels: []store.Channel{{
					ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up",
					Models: []string{"gpt-4o"},
				}},
			},
		},
		Aliases: map[string][]string{"gpt-4": {"gpt-4", "gpt-4o"}},
	}
	gw := httptest.NewServer(hub.New(st, http.DefaultClient).Handler())
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if gotModel != "gpt-4o" {
		t.Fatalf("upstream model %q", gotModel)
	}
	if resp.Header.Get("X-Fabric-Route-Reason") != "model_fallback" {
		t.Fatalf("reason %s", resp.Header.Get("X-Fabric-Route-Reason"))
	}
	if resp.Header.Get("X-Fabric-Upstream-Model") != "gpt-4o" {
		t.Fatalf("audit model %s", resp.Header.Get("X-Fabric-Upstream-Model"))
	}
}

func TestPriority1Both5xxThenPriority2(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		got = append(got, key)
		if key != "sk-p2" {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":"down"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-p1a", Priority: 1},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-p1b", Priority: 1},
		{ID: 3, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-p2", Priority: 2},
	})
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if strings.Join(got, ",") != "sk-p1a,sk-p1b,sk-p2" {
		t.Fatalf("hits %v", got)
	}
	if resp.Header.Get("X-Fabric-Tried") != "1,2,3" {
		t.Fatalf("tried %s", resp.Header.Get("X-Fabric-Tried"))
	}
}

func TestBackupGroupWeightedAfterPrimaryFail(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if key == "sk-p1" {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":"down"}`))
			return
		}
		got = append(got, key)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-p1", Priority: 1},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-a", Priority: 2, Weight: 3},
		{ID: 3, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-b", Priority: 2, Weight: 1},
	})
	t.Cleanup(gw.Close)
	for i := 0; i < 4; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("status %d", resp.StatusCode)
		}
	}
	if strings.Join(got, ",") != "sk-a,sk-a,sk-a,sk-b" {
		t.Fatalf("backup weights %v", got)
	}
}

func TestWeightedRRIsolatedByModel(t *testing.T) {
	type hit struct{ model, key string }
	var hits []hit
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var m struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(raw, &m)
		hits = append(hits, hit{m.Model, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{
		{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-a", Weight: 1},
		{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-b", Weight: 1},
	})
	t.Cleanup(gw.Close)
	models := []string{"gpt-4", "gpt-4o", "gpt-4", "gpt-4o"}
	for _, model := range models {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"`+model+`","messages":[]}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("%s status %d", model, resp.StatusCode)
		}
	}
	var gpt4, gpt4o []string
	for _, h := range hits {
		if h.model == "gpt-4" {
			gpt4 = append(gpt4, h.key)
		}
		if h.model == "gpt-4o" {
			gpt4o = append(gpt4o, h.key)
		}
	}
	if strings.Join(gpt4, ",") != "sk-a,sk-b" {
		t.Fatalf("gpt-4 rotation %v", gpt4)
	}
	if strings.Join(gpt4o, ",") != "sk-a,sk-b" {
		t.Fatalf("gpt-4o rotation %v", gpt4o)
	}
}

func TestRouteDecisionReplayFromMemory(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 7, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up", Priority: 1},
		}},
	}}
	gw := httptest.NewServer(hub.New(st, http.DefaultClient).Handler())
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	dec, err := st.RecentRoutes(req.Context(), 1)
	if err != nil || len(dec) != 1 {
		t.Fatalf("routes %v %v", dec, err)
	}
	d := dec[0]
	if d.ChannelID != 7 || d.Reason != "priority" || d.Fallback || d.Status != 200 {
		t.Fatalf("decision %+v", d)
	}
	if d.RequestedModel != "gpt-4" || d.UpstreamModel != "gpt-4" || d.Protocol != store.ProtocolOpenAI {
		t.Fatalf("models %+v", d)
	}
	if len(d.Tried) != 1 || d.Tried[0] != 7 {
		t.Fatalf("tried %+v", d.Tried)
	}

	st2 := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 9, Protocol: store.ProtocolOpenAI, BaseURL: "http://127.0.0.1:1", Secret: "sk-up"},
		}},
	}}
	gw2 := httptest.NewServer(hub.New(st2, http.DefaultClient).Handler())
	t.Cleanup(gw2.Close)
	req, _ = http.NewRequest(http.MethodPost, gw2.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	dec, err = st2.RecentRoutes(req.Context(), 1)
	if err != nil || len(dec) != 1 {
		t.Fatalf("net routes %v %v", dec, err)
	}
	if dec[0].Status != 502 || dec[0].ChannelID != 9 || dec[0].Fallback || dec[0].Reason != "priority" {
		t.Fatalf("net decision %+v", dec[0])
	}
	if resp.Header.Get("X-Fabric-Tried") != "9" || resp.Header.Get("X-Fabric-Route-Reason") != "priority" {
		t.Fatalf("net headers tried=%s reason=%s", resp.Header.Get("X-Fabric-Tried"), resp.Header.Get("X-Fabric-Route-Reason"))
	}

	req, _ = http.NewRequest(http.MethodPost, gw2.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","stream":true}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	dec, err = st2.RecentRoutes(req.Context(), 1)
	if err != nil || len(dec) != 2 {
		t.Fatalf("stream net routes %d %v", len(dec), err)
	}
	if dec[1].Status != 502 || dec[1].Fallback || dec[1].Reason != "priority" {
		t.Fatalf("stream net decision %+v", dec[1])
	}

	st3 := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: "http://127.0.0.1:1", Secret: "sk-a", Priority: 1},
			{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: "http://127.0.0.1:1", Secret: "sk-b", Priority: 1},
		}},
	}}
	gw3 := httptest.NewServer(hub.New(st3, http.DefaultClient).Handler())
	t.Cleanup(gw3.Close)
	req, _ = http.NewRequest(http.MethodPost, gw3.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	dec, err = st3.RecentRoutes(req.Context(), 1)
	if err != nil || len(dec) != 1 {
		t.Fatalf("multi net %v %v", dec, err)
	}
	if !dec[0].Fallback || dec[0].Reason != "failover" || dec[0].Status != 502 {
		t.Fatalf("multi net decision %+v", dec[0])
	}
	if resp.Header.Get("X-Fabric-Tried") != "1,2" {
		t.Fatalf("multi tried %s", resp.Header.Get("X-Fabric-Tried"))
	}
}

func TestTwoVKsDifferentPools(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-team-a": {
			VirtualKeyID: 1, PoolID: 10, PoolGroup: "premium", TeamID: 1, TeamName: "A", ProjectID: 100, ProjectName: "pa",
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-a", PoolID: 10, TeamID: 1, KeyTeamID: 1}},
		},
		"fab-team-b": {
			VirtualKeyID: 2, PoolID: 20, PoolGroup: "bulk", TeamID: 2, TeamName: "B", ProjectID: 200, ProjectName: "pb",
			Channels: []store.Channel{{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-b", PoolID: 20, TeamID: 2, KeyTeamID: 2}},
		},
	}}
	gw := httptest.NewServer(hub.New(st, http.DefaultClient).Handler())
	t.Cleanup(gw.Close)
	for _, vk := range []string{"fab-team-a", "fab-team-b"} {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
		req.Header.Set("Authorization", "Bearer "+vk)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("%s status %d", vk, resp.StatusCode)
		}
		_ = resp.Body.Close()
	}
	if strings.Join(got, ",") != "sk-a,sk-b" {
		t.Fatalf("hits %v", got)
	}
}

func TestTeamACannotUseTeamBKey(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {
			VirtualKeyID: 1, PoolID: 10, PoolGroup: "standard", TeamID: 1, ProjectID: 100,
			Channels: []store.Channel{
				{ID: 99, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-team-b", PoolID: 10, TeamID: 2, KeyTeamID: 2},
			},
		},
	}}
	gw := httptest.NewServer(hub.New(st, http.DefaultClient).Handler())
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
	if len(got) != 0 {
		t.Fatalf("leaked to B key: %v", got)
	}
}

func TestPoolGroupsVisibleInAudit(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	groups := []string{"premium", "standard", "bulk"}
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{}}
	for i, g := range groups {
		id := int64(i + 1)
		st.ByRawKey["fab-"+g] = &store.ResolvedVK{
			VirtualKeyID: id, PoolID: id * 10, PoolGroup: g, TeamID: id, ProjectID: id * 100,
			Channels: []store.Channel{{
				ID: id, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-" + g,
				PoolID: id * 10, TeamID: id, KeyTeamID: id,
			}},
		}
	}
	gw := httptest.NewServer(hub.New(st, http.DefaultClient).Handler())
	t.Cleanup(gw.Close)
	for _, g := range groups {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
		req.Header.Set("Authorization", "Bearer fab-"+g)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.Header.Get("X-Fabric-Pool-Group") != g {
			t.Fatalf("header group %s", resp.Header.Get("X-Fabric-Pool-Group"))
		}
		_ = resp.Body.Close()
	}
	dec, err := st.RecentRoutes(context.Background(), 0)
	if err != nil || len(dec) != 3 {
		t.Fatalf("routes %d %v", len(dec), err)
	}
	seen := map[string]bool{}
	for _, d := range dec {
		seen[d.PoolGroup] = true
		if d.TeamID == 0 || d.PoolID == 0 {
			t.Fatalf("missing chain %+v", d)
		}
	}
	for _, g := range groups {
		if !seen[g] {
			t.Fatalf("missing group %s", g)
		}
	}
}

func TestOwnerlessVKCannotUseTeamedChannel(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {
			VirtualKeyID: 1, PoolID: 10,
			Channels: []store.Channel{{
				ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-team-b",
				PoolID: 10, TeamID: 2, KeyTeamID: 2,
			}},
		},
	}}
	gw := httptest.NewServer(hub.New(st, http.DefaultClient).Handler())
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
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatal("ownerless VK hit teamed upstream")
	}
}

func TestOwnerlessVKLegacyChannelOK(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{{
		ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-legacy",
	}})
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestTeamVKRejectsZeroPoolChannel(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {
			VirtualKeyID: 1, PoolID: 10, TeamID: 1, ProjectID: 100,
			Channels: []store.Channel{{
				ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-a",
				PoolID: 0, TeamID: 1, KeyTeamID: 1,
			}},
		},
	}}
	gw := httptest.NewServer(hub.New(st, http.DefaultClient).Handler())
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
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatal("zero pool_id treated as wildcard")
	}
}

func TestVKBurstThen429(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, RPMLimit: 60, RPMBurst: 3, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = hub.NewLimiter(clk)
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	for i := 0; i < 3; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("burst %d status %d", i, resp.StatusCode)
		}
		_ = resp.Body.Close()
	}
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 429 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(raw), "vk_rate_limit_exceeded") || !strings.Contains(string(raw), `"dimension":"vk"`) {
		t.Fatalf("body %s", raw)
	}
	if atomic.LoadInt32(&hits) != 3 {
		t.Fatalf("upstream hits %d", hits)
	}
}

func TestProviderBurstThen429(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up", ProviderCode: "deepseek", ProviderRPM: 60, ProviderBurst: 2},
		}},
	}}
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = hub.NewLimiter(clk)
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	for i := 0; i < 2; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("status %d", resp.StatusCode)
		}
	}
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 429 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(raw), "provider_rate_limit_exceeded") || !strings.Contains(string(raw), `"dimension":"provider"`) {
		t.Fatalf("body %s", raw)
	}
	if atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("hits %d", hits)
	}
}

func TestCircuitOpensAndShiftsInPool(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		got = append(got, key)
		if key == "sk-bad" {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":"down"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 7, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-bad", Priority: 1},
			{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-ok", Priority: 2},
		}},
	}}
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = hub.NewLimiter(clk)
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	for i := 0; i < 2; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
	}
	before := len(got)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	for _, k := range got[before:] {
		if k == "sk-bad" {
			t.Fatalf("open circuit still hit: %v", got)
		}
	}
}

func TestHalfOpenProbeRecoverAndReopen(t *testing.T) {
	var hits int32
	fail := atomic.Bool{}
	fail.Store(true)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if fail.Load() {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = hub.NewLimiter(clk)
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	do := func() int {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}
	if do() != 502 || do() != 502 {
		t.Fatal("need two fails to open")
	}
	openHits := atomic.LoadInt32(&hits)
	if stt := do(); stt != 503 {
		t.Fatalf("expected circuit open 503 got %d", stt)
	}
	if atomic.LoadInt32(&hits) != openHits {
		t.Fatal("open circuit still probed")
	}
	clk.Advance(16 * time.Second)
	fail.Store(false)
	if do() != 200 {
		t.Fatal("half-open probe should succeed")
	}
	if do() != 200 {
		t.Fatal("recovered channel should stay closed")
	}
	fail.Store(true)
	_ = do()
	_ = do()
	clk.Advance(16 * time.Second)
	before := atomic.LoadInt32(&hits)
	_ = do()
	if atomic.LoadInt32(&hits) != before+1 {
		t.Fatal("half-open should allow one probe")
	}
	if do() != 503 {
		t.Fatal("failed probe should reopen")
	}
}

func Test400DoesNotTripCircuit(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"bad"}`))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = hub.NewLimiter(clk)
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	for i := 0; i < 5; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 400 {
			t.Fatalf("status %d", resp.StatusCode)
		}
		_ = resp.Body.Close()
	}
	if atomic.LoadInt32(&hits) != 5 {
		t.Fatalf("400 tripped circuit, hits %d", hits)
	}
}

func TestPoolHealthReadable(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 42, RPMLimit: 60, RPMBurst: 10, Channels: []store.Channel{
			{ID: 8, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = hub.NewLimiter(clk)
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	for i := 0; i < 2; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, _ := http.DefaultClient.Do(req)
		_ = resp.Body.Close()
	}
	resp, err := http.Get(gw.URL + "/health/limits")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(raw), `"pool_id":42`) || !strings.Contains(string(raw), `"state":"open"`) {
		t.Fatalf("limits %s", raw)
	}
	if !strings.Contains(string(raw), `"healthy_channels"`) || !strings.Contains(string(raw), `"tokens"`) {
		t.Fatalf("capacity %s", raw)
	}
}

func TestDiscardedUpstreamNotImplicit200(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"down"}`))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	lim := hub.NewLimiter(clk)
	lim.Record(1, 2, 0, false, true)
	lim.Record(1, 2, 0, false, true)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-a", Priority: 1},
			{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-b", Priority: 2},
		}},
	}}
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = lim
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 400 {
		t.Fatalf("implicit success %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
	dec, _ := st.RecentRoutes(req.Context(), 1)
	if len(dec) != 1 || dec[0].Status < 400 {
		t.Fatalf("audit %+v", dec)
	}
}

func TestDiscardedThenProviderLimitedNot200(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	lim := hub.NewLimiter(clk)
	_ = lim.AllowProvider("p", 60, 1)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-a", Priority: 1},
			{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-b", Priority: 2, ProviderCode: "p", ProviderRPM: 60, ProviderBurst: 1},
		}},
	}}
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = lim
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 400 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
}

func TestHalfOpenProviderLimitReleasesPermit(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	lim := hub.NewLimiter(clk)
	lim.Record(1, 1, 0, false, true)
	lim.Record(1, 1, 0, false, true)
	clk.Advance(16 * time.Second)
	_ = lim.AllowProvider("p", 60, 1)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up", ProviderCode: "p", ProviderRPM: 60, ProviderBurst: 1},
		}},
	}}
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = lim
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatal("should not hit while provider limited")
	}
	clk.Advance(time.Minute)
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("permit stuck status %d", resp.StatusCode)
	}
}

func TestCancelDoesNotTripCircuit(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = hub.NewLimiter(clk)
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	for i := 0; i < 2; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			_ = resp.Body.Close()
		}
	}
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("cancel tripped circuit %d", resp.StatusCode)
	}
}

func TestProbeOnceWithoutUserTraffic(t *testing.T) {
	var probes int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			atomic.AddInt32(&probes, 1)
			w.WriteHeader(200)
			return
		}
		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	lim := hub.NewLimiter(clk)
	ch := store.Channel{ID: 1, PoolID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}
	lim.RegisterPool(1, []store.Channel{ch})
	lim.Record(1, 1, 0, false, true)
	lim.Record(1, 1, 0, false, true)
	clk.Advance(16 * time.Second)
	lim.Tick()
	srv := hub.New(&store.Memory{}, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = lim
	if !srv.ProbeOnce(ch) {
		t.Fatal("probe should succeed")
	}
	if atomic.LoadInt32(&probes) != 1 {
		t.Fatalf("probes %d", probes)
	}
	if snap := lim.Snapshot(); snap.Pools[0].Healthy != 1 {
		t.Fatalf("not closed after probe %+v", snap)
	}
	lim.Record(1, 1, 0, false, true)
	lim.Record(1, 1, 0, false, true)
	clk.Advance(16 * time.Second)
	lim.Tick()
	failUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(502)
	}))
	t.Cleanup(failUp.Close)
	ch.BaseURL = failUp.URL
	if srv.ProbeOnce(ch) {
		t.Fatal("failed probe should be false")
	}
}

func TestSnapshotCountsUnregisteredHits(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 9, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-a", Priority: 1, ProviderRPM: 10},
			{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-b", Priority: 2, ProviderRPM: 10},
			{ID: 3, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-c", Priority: 2, ProviderRPM: 10},
		}},
	}}
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Limits = hub.NewLimiter(clk)
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	snap := srv.Limits.Snapshot()
	if len(snap.Pools) != 1 || snap.Pools[0].Total != 3 || snap.Pools[0].Healthy != 3 {
		t.Fatalf("snap %+v", snap.Pools)
	}
	if snap.Pools[0].RPMCapacity != 30 || snap.Pools[0].RPMAvailable != 30 {
		t.Fatalf("cap %+v", snap.Pools[0])
	}
	srv.Limits.Record(9, 1, 0, false, true)
	srv.Limits.Record(9, 1, 0, false, true)
	snap = srv.Limits.Snapshot()
	if snap.Pools[0].Healthy != 2 || snap.Pools[0].RPMAvailable != 20 {
		t.Fatalf("after open %+v", snap.Pools[0])
	}
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

func usageBody(total int) string {
	return `{"id":"chatcmpl-fixed","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"hello-fixed"},"finish_reason":"stop"}],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":` + strconv.Itoa(total) + `}}`
}

func newBudgetGateway(t *testing.T, vk *store.ResolvedVK, clk *hub.FakeClock) (*hub.Server, *store.Memory, *httptest.Server) {
	t.Helper()
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{testVK: vk}}
	srv := hub.New(st, http.DefaultClient)
	if clk != nil {
		srv.Clock = clk
		srv.Budget = hub.NewMemoryBudget(clk)
		srv.Limits = hub.NewLimiter(clk)
	}
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	return srv, st, gw
}

func doChat(t *testing.T, gw *httptest.Server, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+testVK)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

type budgetView struct {
	Used     int64
	Settled  int64
	Reserved int64
	Month    string
}

func readBudget(t *testing.T, gw *httptest.Server, vkID int64) budgetView {
	t.Helper()
	resp, err := http.Get(gw.URL + "/health/budget")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var body struct {
		Month   string `json:"month"`
		Budgets []struct {
			VKID     int64  `json:"vk_id"`
			Used     int64  `json:"used"`
			Settled  int64  `json:"settled"`
			Reserved int64  `json:"reserved"`
			Month    string `json:"month"`
		} `json:"budgets"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("budget json %s: %v", raw, err)
	}
	var fallback budgetView
	for _, e := range body.Budgets {
		if e.VKID != vkID {
			continue
		}
		v := budgetView{Used: e.Used, Settled: e.Settled, Reserved: e.Reserved, Month: e.Month}
		if e.Month == body.Month {
			return v
		}
		if fallback.Month == "" {
			fallback = v
		}
	}
	return fallback
}

func budgetUsedOf(t *testing.T, gw *httptest.Server, vkID int64) int64 {
	t.Helper()
	return readBudget(t, gw, vkID).Used
}

func seedUsed(t *testing.T, b hub.HotBudget, vkID int64, month string, hard, used int64) {
	t.Helper()
	lease, ok := b.Reserve(vkID, month, hard, hub.ReserveSpec{OutputCap: used, HasCap: true})
	if !ok {
		t.Fatal("seed reserve")
	}
	b.Settle(lease, used)
}

func waitBudgetUsed(t *testing.T, gw *httptest.Server, vkID int64, min int64) int64 {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var used int64
	for time.Now().Before(deadline) {
		used = budgetUsedOf(t, gw, vkID)
		if used >= min {
			return used
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("budget used %d want >= %d", used, min)
	return used
}

func TestBudgetSoftWarning(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(usageBody(15)))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, st, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 100, MonthlySoft: 10,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	resp := doChat(t, gw, `{"model":"gpt-4","messages":[]}`)
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if resp.Header.Get("X-Fabric-Budget-Soft") != "1" {
		t.Fatalf("missing soft header %v", resp.Header)
	}
	if resp.Header.Get("X-Fabric-Budget-Used") != "15" {
		t.Fatalf("used header %q", resp.Header.Get("X-Fabric-Budget-Used"))
	}
	if resp.Header.Get("X-Fabric-Budget-Month") != "2026-01" {
		t.Fatalf("month %q", resp.Header.Get("X-Fabric-Budget-Month"))
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
	dec, err := st.RecentRoutes(context.Background(), 1)
	if err != nil || len(dec) != 1 || !dec[0].BudgetSoft || dec[0].BudgetUsed != 15 {
		t.Fatalf("audit %+v err %v", dec, err)
	}
}

func TestBudgetHardRejectZeroUpstream(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(usageBody(5)))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	srv, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 5,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	seedUsed(t, srv.Budget, 1, "2026-01", 5, 5)
	resp := doChat(t, gw, `{"model":"gpt-4","messages":[],"max_tokens":5}`)
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("status %d body %s", resp.StatusCode, raw)
	}
	if !strings.Contains(string(raw), "budget_exceeded") {
		t.Fatalf("body %s", raw)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("upstream hits %d", hits)
	}
}

func TestBudgetConcurrentNoPierce(t *testing.T) {
	var hits int32
	release := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		<-release
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(usageBody(2)))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 10,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	const n = 8
	var wg sync.WaitGroup
	var ok, blocked int32
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			resp := doChat(t, gw, `{"model":"gpt-4","messages":[],"max_tokens":5}`)
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
			switch resp.StatusCode {
			case 200:
				atomic.AddInt32(&ok, 1)
			case http.StatusPaymentRequired:
				atomic.AddInt32(&blocked, 1)
			default:
				t.Errorf("status %d", resp.StatusCode)
			}
		}()
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && atomic.LoadInt32(&hits) < 2 {
		time.Sleep(5 * time.Millisecond)
	}
	if atomic.LoadInt32(&hits) != 2 {
		close(release)
		wg.Wait()
		t.Fatalf("in-flight hits %d", hits)
	}
	time.Sleep(20 * time.Millisecond)
	if atomic.LoadInt32(&hits) > 2 {
		close(release)
		wg.Wait()
		t.Fatalf("pierced hits %d", hits)
	}
	snap := readBudget(t, gw, 1)
	if snap.Used+snap.Reserved > 10 {
		close(release)
		wg.Wait()
		t.Fatalf("used+reserved %+v", snap)
	}
	if snap.Reserved != 10 {
		close(release)
		wg.Wait()
		t.Fatalf("reserved %+v", snap)
	}
	close(release)
	wg.Wait()
	if atomic.LoadInt32(&ok) != 2 || atomic.LoadInt32(&blocked) != n-2 {
		t.Fatalf("ok=%d blocked=%d hits=%d", ok, blocked, hits)
	}
	if got := readBudget(t, gw, 1); got.Settled != 4 || got.Reserved != 0 {
		t.Fatalf("after settle %+v", got)
	}
}

func TestBudgetMonthRollover(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(usageBody(5)))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC))
	srv, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 10,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	seedUsed(t, srv.Budget, 1, "2026-01", 10, 10)
	resp := doChat(t, gw, `{"model":"gpt-4","messages":[],"max_tokens":5}`)
	if resp.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("jan status %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("jan hits %d", hits)
	}
	clk.Advance(20 * 24 * time.Hour)
	resp = doChat(t, gw, `{"model":"gpt-4","messages":[],"max_tokens":5}`)
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("feb status %d %s", resp.StatusCode, raw)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("feb hits %d", hits)
	}
	if budgetUsedOf(t, gw, 1) < 5 {
		t.Fatalf("feb used %d", budgetUsedOf(t, gw, 1))
	}
}

func TestStreamBudgetGrows(t *testing.T) {
	next := make(chan string)
	var closeNext sync.Once
	t.Cleanup(func() { closeNext.Do(func() { close(next) }) })
	started := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		w.WriteHeader(200)
		fl.Flush()
		close(started)
		for {
			select {
			case c, ok := <-next:
				if !ok {
					return
				}
				_, _ = io.WriteString(w, c)
				fl.Flush()
			case <-r.Context().Done():
				return
			}
		}
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 10000,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","stream":true}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	<-started
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		_, _ = io.Copy(io.Discard, resp.Body)
	}()
	chunk := func(s string) string {
		return "data: {\"choices\":[{\"delta\":{\"content\":\"" + s + "\"}}]}\n\n"
	}
	next <- chunk("abcdefghijklmnopqrstuvwxyz012345")
	used1 := waitBudgetUsed(t, gw, 1, 1)
	next <- chunk("ABCDEFGHIJKLMNOPQRSTUVWXYZ678901")
	used2 := waitBudgetUsed(t, gw, 1, used1+1)
	if used2 <= used1 {
		t.Fatalf("used did not grow %d -> %d", used1, used2)
	}
	closeNext.Do(func() { close(next) })
	select {
	case <-readDone:
	case <-time.After(2 * time.Second):
		t.Fatal("stream did not finish")
	}
}

func TestOfficialUsageCalibratesNoDouble(t *testing.T) {
	next := make(chan string)
	var closeNext sync.Once
	t.Cleanup(func() { closeNext.Do(func() { close(next) }) })
	started := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		w.WriteHeader(200)
		fl.Flush()
		close(started)
		for {
			select {
			case c, ok := <-next:
				if !ok {
					return
				}
				_, _ = io.WriteString(w, c)
				fl.Flush()
			case <-r.Context().Done():
				return
			}
		}
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 10000,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","stream":true}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	<-started
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		_, _ = io.Copy(io.Discard, resp.Body)
	}()
	next <- "data: {\"choices\":[{\"delta\":{\"content\":\"abcdefghijklmnopqrstuvwxyz012345\"}}]}\n\n"
	est := waitBudgetUsed(t, gw, 1, 1)
	next <- "data: {\"choices\":[{\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":30,\"total_tokens\":40}}\n\n"
	next <- "data: [DONE]\n\n"
	closeNext.Do(func() { close(next) })
	select {
	case <-readDone:
	case <-time.After(2 * time.Second):
		t.Fatal("stream did not finish")
	}
	used := budgetUsedOf(t, gw, 1)
	if used != 40 {
		t.Fatalf("calibrated used %d est-before %d (double-count?)", used, est)
	}
}

func TestStreamAbortKeepsEstimate(t *testing.T) {
	next := make(chan string)
	var closeNext sync.Once
	t.Cleanup(func() { closeNext.Do(func() { close(next) }) })
	started := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		w.WriteHeader(200)
		fl.Flush()
		close(started)
		for {
			select {
			case c, ok := <-next:
				if !ok {
					return
				}
				_, _ = io.WriteString(w, c)
				fl.Flush()
			case <-r.Context().Done():
				return
			}
		}
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 10000,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","stream":true}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	<-started
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()
	next <- "data: {\"choices\":[{\"delta\":{\"content\":\"abcdefghijklmnopqrstuvwxyz012345\"}}]}\n\n"
	est := waitBudgetUsed(t, gw, 1, 1)
	cancel()
	closeNext.Do(func() { close(next) })
	select {
	case <-readDone:
	case <-time.After(2 * time.Second):
		t.Fatal("abort did not finish")
	}
	used := budgetUsedOf(t, gw, 1)
	if used < est {
		t.Fatalf("abort dropped estimate %d -> %d", est, used)
	}
}

func TestAnthropicOfficialUsage(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":11,"output_tokens":7}}`))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 1000,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolAnthropic, BaseURL: up.URL, Secret: "sk-a"}},
	}, clk)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(`{"model":"claude","messages":[]}`))
	req.Header.Set("X-Api-Key", testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d %s", resp.StatusCode, raw)
	}
	if budgetUsedOf(t, gw, 1) != 18 {
		t.Fatalf("used %d", budgetUsedOf(t, gw, 1))
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
}

func TestAnthropicStreamUsageCalibrates(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		_, _ = io.WriteString(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":9,\"output_tokens\":1}}}\n\n")
		fl.Flush()
		_, _ = io.WriteString(w, "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"abcdefghijklmnopqrstuvwxyz012345\"}}\n\n")
		fl.Flush()
		_, _ = io.WriteString(w, "event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":20}}\n\n")
		fl.Flush()
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 1000,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolAnthropic, BaseURL: up.URL, Secret: "sk-a"}},
	}, clk)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/messages", strings.NewReader(`{"model":"claude","stream":true}`))
	req.Header.Set("X-Api-Key", testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if budgetUsedOf(t, gw, 1) != 29 {
		t.Fatalf("used %d want 29 (9+20)", budgetUsedOf(t, gw, 1))
	}
}

func TestBudgetVKIsolation(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(usageBody(5)))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, MonthlyHard: 5, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
		"fab-other": {VirtualKeyID: 2, PoolID: 1, MonthlyHard: 5, Channels: []store.Channel{
			{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"},
		}},
	}}
	srv := hub.New(st, http.DefaultClient)
	srv.Clock = clk
	srv.Budget = hub.NewMemoryBudget(clk)
	gw := httptest.NewServer(srv.Handler())
	t.Cleanup(gw.Close)
	seedUsed(t, srv.Budget, 1, "2026-01", 5, 5)
	resp := doChat(t, gw, `{"model":"gpt-4","max_tokens":5}`)
	if resp.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("vk1 %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-other")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("vk2 %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
}

func TestBudgetLargePromptRejects(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(usageBody(1)))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 10,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	body := `{"model":"gpt-4","max_tokens":1,"messages":[{"role":"user","content":"` + strings.Repeat("abcd", 20) + `"}]}`
	resp := doChat(t, gw, body)
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("status %d %s", resp.StatusCode, raw)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("hits %d", hits)
	}
	if got := readBudget(t, gw, 1); got.Used != 0 || got.Reserved != 0 {
		t.Fatalf("ledger %+v", got)
	}
}

func TestBudgetNoChannelReleases(t *testing.T) {
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 100,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolAnthropic, BaseURL: "http://127.0.0.1:1", Secret: "sk-a"}},
	}, clk)
	resp := doChat(t, gw, `{"model":"gpt-4","messages":[],"max_tokens":5}`)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if got := readBudget(t, gw, 1); got.Used != 0 || got.Reserved != 0 || got.Settled != 0 {
		t.Fatalf("ledger %+v", got)
	}
}

func TestBudgetCircuitOpenReleases(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 100,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	for i := 0; i < 2; i++ {
		resp := doChat(t, gw, `{"model":"gpt-4","max_tokens":5}`)
		_ = resp.Body.Close()
	}
	before := atomic.LoadInt32(&hits)
	resp := doChat(t, gw, `{"model":"gpt-4","messages":[],"max_tokens":5}`)
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable || !strings.Contains(string(raw), "circuit_open") {
		t.Fatalf("status %d %s", resp.StatusCode, raw)
	}
	if atomic.LoadInt32(&hits) != before {
		t.Fatalf("circuit still hit upstream")
	}
	if got := readBudget(t, gw, 1); got.Reserved != 0 {
		t.Fatalf("reservation leftover %+v", got)
	}
}

func TestBudgetProviderLimitReleases(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(usageBody(1)))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	srv, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 100,
		Channels: []store.Channel{{
			ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up",
			ProviderCode: "deepseek", ProviderRPM: 60, ProviderBurst: 1,
		}},
	}, clk)
	if !srv.Limits.AllowProvider("deepseek", 60, 1) {
		t.Fatal("pre-consume")
	}
	resp := doChat(t, gw, `{"model":"gpt-4","messages":[],"max_tokens":5}`)
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests || !strings.Contains(string(raw), "provider") {
		t.Fatalf("status %d %s", resp.StatusCode, raw)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("hits %d", hits)
	}
	if got := readBudget(t, gw, 1); got.Used != 0 || got.Reserved != 0 {
		t.Fatalf("ledger %+v", got)
	}
}

func TestStreamCrossSoftTrailer(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"abcdefghijklmnopqrstuvwxyz012345\"}}]}\n\n")
		fl.Flush()
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":15}}\n\n")
		fl.Flush()
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		fl.Flush()
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, _, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 100, MonthlySoft: 10,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","stream":true,"max_tokens":50}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := resp.Trailer["X-Fabric-Budget-Used"]; !ok {
		t.Fatalf("trailer Used not declared: header=%v trailer=%v", resp.Header, resp.Trailer)
	}
	if _, ok := resp.Trailer["X-Fabric-Budget-Soft"]; !ok {
		t.Fatalf("trailer Soft not declared: %v", resp.Trailer)
	}
	if resp.Header.Get("X-Fabric-Budget-Soft") == "1" {
		t.Fatal("initial header should not yet be over soft")
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.Trailer.Get("X-Fabric-Budget-Used") != "15" {
		t.Fatalf("trailer used %q", resp.Trailer.Get("X-Fabric-Budget-Used"))
	}
	if resp.Trailer.Get("X-Fabric-Budget-Soft") != "1" {
		t.Fatalf("trailer soft %q", resp.Trailer.Get("X-Fabric-Budget-Soft"))
	}
}

func TestStreamAbortKeepsAudit(t *testing.T) {
	next := make(chan string)
	var closeNext sync.Once
	t.Cleanup(func() { closeNext.Do(func() { close(next) }) })
	started := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		w.WriteHeader(200)
		fl.Flush()
		close(started)
		for {
			select {
			case c, ok := <-next:
				if !ok {
					return
				}
				_, _ = io.WriteString(w, c)
				fl.Flush()
			case <-r.Context().Done():
				return
			}
		}
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, st, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 10000,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","stream":true,"max_tokens":50}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	<-started
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()
	next <- "data: {\"choices\":[{\"delta\":{\"content\":\"abcdefghijklmnopqrstuvwxyz012345\"}}]}\n\n"
	est := waitBudgetUsed(t, gw, 1, 1)
	cancel()
	closeNext.Do(func() { close(next) })
	select {
	case <-readDone:
	case <-time.After(2 * time.Second):
		t.Fatal("abort did not finish")
	}
	deadline := time.Now().Add(2 * time.Second)
	var dec []store.RouteDecision
	for time.Now().Before(deadline) {
		dec, _ = st.RecentRoutes(context.Background(), 1)
		if len(dec) > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if len(dec) == 0 || dec[0].BudgetUsed < est {
		t.Fatalf("abort audit %+v est %d", dec, est)
	}
}

func TestBudgetOfficialOverageBlocksNext(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		if n == 1 {
			_, _ = w.Write([]byte(usageBody(12)))
			return
		}
		_, _ = w.Write([]byte(usageBody(1)))
	}))
	t.Cleanup(up.Close)
	clk := hub.NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	_, st, gw := newBudgetGateway(t, &store.ResolvedVK{
		VirtualKeyID: 1, PoolID: 1, MonthlyHard: 10,
		Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk-up"}},
	}, clk)
	resp := doChat(t, gw, `{"model":"gpt-4","messages":[],"max_tokens":5}`)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("first %d", resp.StatusCode)
	}
	if got := readBudget(t, gw, 1); got.Settled != 12 {
		t.Fatalf("clamped? %+v", got)
	}
	resp = doChat(t, gw, `{"model":"gpt-4","messages":[],"max_tokens":5}`)
	if resp.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("second %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
	dec, _ := st.RecentRoutes(context.Background(), 1)
	if len(dec) == 0 || !dec[0].BudgetOver || dec[0].BudgetUsed != 12 {
		t.Fatalf("overage audit %+v", dec)
	}
}
