package webui

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPages(t *testing.T) {
	s := httptest.NewServer(Handler())
	t.Cleanup(s.Close)
	cases := map[string]string{"/": "Token Hub", "/admin": "管理后台", "/me": "申请 VK"}
	for p, want := range cases {
		resp, err := http.Get(s.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("%s status %d", p, resp.StatusCode)
		}
		if !strings.Contains(string(b), want) {
			t.Fatalf("%s missing %q in %s", p, want, b)
		}
	}
}
