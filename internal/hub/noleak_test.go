package hub_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"kodax-fabric/internal/store"
)

func TestCallerResponseNeverContainsProviderSecret(t *testing.T) {
	const liveSecret = "sk-fixture-must-not-appear-in-caller-json"
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.Contains(auth, liveSecret) {
			t.Errorf("upstream should receive provider secret, got %q", auth)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"x","choices":[{"message":{"role":"assistant","content":"pong"}}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{{
		ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: liveSecret,
	}})
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(raw), liveSecret) {
		t.Fatalf("secret leaked in caller JSON: %s", raw)
	}
	for k, vals := range resp.Header {
		for _, v := range vals {
			if strings.Contains(v, liveSecret) {
				t.Fatalf("secret leaked in header %s: %s", k, v)
			}
		}
	}
}
