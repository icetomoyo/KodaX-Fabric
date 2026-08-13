package webui

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestPagesServeShadcnSPA(t *testing.T) {
	h := Handler()
	var adminBodies [][]byte
	for _, path := range []string{"/", "/admin", "/me"} {
		for i := 1; i <= 2; i++ {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("%s attempt %d status %d", path, i, rec.Code)
			}
			body := rec.Body.String()
			if !strings.Contains(body, `id="root"`) || !strings.Contains(body, `data-ui="shadcn"`) {
				t.Fatalf("%s attempt %d missing shadcn spa root: %s", path, i, body)
			}
			if !strings.Contains(body, "Token Hub") {
				t.Fatalf("%s attempt %d missing Token Hub: %s", path, i, body)
			}
			if !strings.Contains(body, "/assets/") {
				t.Fatalf("%s attempt %d does not load bundled assets: %s", path, i, body)
			}
			if strings.Contains(body, `onclick="login()"`) || strings.Contains(body, "admin.html") || strings.Contains(body, "/ui/admin.js") {
				t.Fatalf("%s still serving old HTML: %s", path, body)
			}
			if path == "/admin" {
				adminBodies = append(adminBodies, append([]byte(nil), rec.Body.Bytes()...))
			}
		}
	}
	if dir := os.Getenv("WEBUI_CAPTURE_DIR"); dir != "" && len(adminBodies) >= 2 {
		if err := os.WriteFile(dir+"/pages-1.html", adminBodies[0], 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(dir+"/pages-2.html", adminBodies[1], 0644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAssetBundleServed(t *testing.T) {
	idx, err := os.ReadFile("dist/index.html")
	if err != nil {
		t.Fatal(err)
	}
	script := ""
	for _, part := range strings.Split(string(idx), `"`) {
		if strings.HasPrefix(part, "/assets/") && strings.HasSuffix(part, ".js") {
			script = part
			break
		}
	}
	if script == "" {
		t.Fatalf("no /assets/*.js in dist/index.html: %s", idx)
	}
	req := httptest.NewRequest(http.MethodGet, script, nil)
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s status %d", script, rec.Code)
	}
	js := rec.Body.String()
	if !strings.Contains(js, "/api/v1/auth/login") || !strings.Contains(js, "/v1/chat/completions") || !strings.Contains(js, "/v1/messages") {
		t.Fatalf("bundle missing operator API or dual-endpoint copy: %s", script)
	}
}

func TestOldHTMLNotShipped(t *testing.T) {
	for _, name := range []string{"static/admin.html", "static/me.html", "static/home.html", "static/admin.js", "static/me.js"} {
		if _, err := os.Stat(name); err == nil {
			t.Fatalf("old surface still present: %s", name)
		}
	}
}

func getBody(t *testing.T, path string) string {
	t.Helper()
	s := httptest.NewServer(Handler())
	t.Cleanup(s.Close)
	resp, err := http.Get(s.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}

func TestPagesOverHTTP(t *testing.T) {
	body := getBody(t, "/admin")
	if !strings.Contains(body, `data-ui="shadcn"`) {
		t.Fatalf("http /admin not spa: %s", body)
	}
}
