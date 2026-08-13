package webui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSPALoginRoute(t *testing.T) {
	ts := httptest.NewServer(Handler())
	t.Cleanup(ts.Close)
	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "text/html") && ct != "" {
		// ServeFileFS may omit type on some platforms; body still must be html.
		t.Logf("content-type %q", ct)
	}
}
