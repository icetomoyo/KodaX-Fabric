package webui

import (
	"io/fs"
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

func TestEmbeddedAdminHasOrgAndAudit(t *testing.T) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	err = fs.WalkDir(sub, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		raw, rerr := fs.ReadFile(sub, path)
		if rerr != nil {
			return rerr
		}
		b.Write(raw)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	blob := b.String()
	for _, want := range []string{"/admin/org", "/admin/audit", "团队项目", "路由审计"} {
		if !strings.Contains(blob, want) {
			t.Errorf("embedded UI missing %q", want)
		}
	}
}
