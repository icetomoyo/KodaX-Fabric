package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMeUnauthenticatedIsOK(t *testing.T) {
	api := &API{Sessions: NewSessions()}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	rec := httptest.NewRecorder()
	api.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var out struct {
		OK   bool            `json:"ok"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if !out.OK || string(out.Data) != "null" {
		t.Fatalf("want ok+null, got %s", rec.Body.String())
	}
}

func TestMeAuthenticated(t *testing.T) {
	s := NewSessions()
	tok := s.Put(1, "admin", "18612243416", "ops")
	api := &API{Sessions: s}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: "th_session", Value: tok})
	rec := httptest.NewRecorder()
	api.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"role":"admin"`) || !strings.Contains(body, `"phone":"18612243416"`) {
		t.Fatalf("missing session fields: %s", body)
	}
}
