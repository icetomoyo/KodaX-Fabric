package webui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminIndex(t *testing.T) {
	h := Handler()
	req := httptest.NewRequest(http.MethodGet, "/admin", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Token Hub") && rec.Body.Len() == 0 {
		t.Fatalf("empty body")
	}
}
