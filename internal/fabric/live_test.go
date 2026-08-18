package fabric_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestLiveOpenAIProviderForwardsRawBodyAndProviderKey(t *testing.T) {
	var gotAuth, gotBody string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path %s", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"up","usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}`))
	}))
	t.Cleanup(up.Close)

	p := fabric.NewLiveProvider(up.URL, "sk-provider")
	raw := []byte(`{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"ping"}]}`)
	status, header, rc, err := p.ChatCompletions(t.Context(), raw)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	body, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	if gotAuth != "Bearer sk-provider" {
		t.Fatalf("auth %q", gotAuth)
	}
	if gotBody != string(raw) {
		t.Fatalf("body %s", gotBody)
	}
	if header["Content-Type"] != "application/json" {
		t.Fatalf("content-type %v", header)
	}
	if string(body) == "" || body[0] != '{' {
		t.Fatalf("upstream body %s", body)
	}
}
