package fabric_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestNewRequestUsesNewMarkupOldRequestUnchanged(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	putJSON(t, admin, srv.URL+"/admin/api/markup", map[string]float64{"markup": 2})

	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("first %d", status)
	}
	first := waitCustomerRows(t, admin, srv.URL)
	if len(first) != 1 {
		t.Fatalf("first rows %+v", first)
	}
	// fixture 10/20 at 1/2 per million → cost 0.00005; markup 2 → 0.00010
	if delta := first[0].CustomerCNY - 0.0001; delta > 1e-12 || delta < -1e-12 {
		t.Fatalf("customer %v cost %v", first[0].CustomerCNY, first[0].CostCNY)
	}

	putJSON(t, admin, srv.URL+"/admin/api/markup", map[string]float64{"markup": 3})
	status, _ = postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("second %d", status)
	}
	rows := waitCustomerRows(t, admin, srv.URL)
	if len(rows) != 2 {
		t.Fatalf("rows %+v", rows)
	}
	if delta := rows[0].CustomerCNY - 0.0001; delta > 1e-12 || delta < -1e-12 {
		t.Fatalf("old row flipped %v", rows[0].CustomerCNY)
	}
	if delta := rows[1].CustomerCNY - 0.00015; delta > 1e-12 || delta < -1e-12 {
		t.Fatalf("new row %v", rows[1].CustomerCNY)
	}
}

type customerRow struct {
	CostCNY     float64 `json:"cost_cny"`
	CustomerCNY float64 `json:"customer_cny"`
}

func waitCustomerRows(t *testing.T, admin *http.Client, base string) []customerRow {
	t.Helper()
	_ = listRequests(t, admin, base)
	resp, err := admin.Get(base + "/admin/api/requests?project=demo")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Requests []customerRow `json:"requests"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	return payload.Requests
}

func decodeMap(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func jsonHasKey(v any, key string) bool {
	switch t := v.(type) {
	case map[string]any:
		if _, ok := t[key]; ok {
			return true
		}
		for _, child := range t {
			if jsonHasKey(child, key) {
				return true
			}
		}
	case []any:
		for _, child := range t {
			if jsonHasKey(child, key) {
				return true
			}
		}
	}
	return false
}

func mustStatus(t *testing.T, resp *http.Response, want int) {
	t.Helper()
	if resp.StatusCode != want {
		b, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		t.Fatalf("status %d want %d: %s", resp.StatusCode, want, b)
	}
}

func getJSON(t *testing.T, client *http.Client, url string) *http.Response {
	t.Helper()
	resp, err := client.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func postJSON(t *testing.T, client *http.Client, url, body string) *http.Response {
	t.Helper()
	resp, err := client.Post(url, "application/json", bytes.NewReader([]byte(body)))
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func headerFloat(t *testing.T, h http.Header, key string) float64 {
	t.Helper()
	s := h.Get(key)
	if s == "" {
		t.Fatalf("missing header %s", key)
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPlatformUsageShowsProfitEnterpriseJSONOmitsCustomer(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	putJSON(t, admin, srv.URL+"/admin/api/markup", map[string]float64{"markup": 2})
	if st, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`); st != http.StatusOK {
		t.Fatalf("chat %d", st)
	}
	_ = listRequests(t, admin, srv.URL)

	plat := getJSON(t, admin, srv.URL+"/platform/api/usage?project=demo&day=2026-08-17")
	mustStatus(t, plat, http.StatusOK)
	platBody := decodeMap(t, plat)
	if !jsonHasKey(platBody, "customer_cny") || !jsonHasKey(platBody, "profit_cny") {
		t.Fatalf("platform missing profit %+v", platBody)
	}

	boss := newEnterpriseAdmin(t, srv, "acme", "acme-boss")
	mustCreateProject(t, boss, srv.URL, "billing")
	ent := getJSON(t, boss, srv.URL+"/enterprise/api/usage?project=billing&day=2026-08-17")
	mustStatus(t, ent, http.StatusOK)
	entBody := decodeMap(t, ent)
	if jsonHasKey(entBody, "customer_cny") || jsonHasKey(entBody, "profit_cny") || jsonHasKey(entBody, "attempts") {
		t.Fatalf("enterprise leaked customer %+v", entBody)
	}

	req := getJSON(t, boss, srv.URL+"/enterprise/api/requests?project=billing")
	mustStatus(t, req, http.StatusOK)
	reqBody := decodeMap(t, req)
	if jsonHasKey(reqBody, "customer_cny") || jsonHasKey(reqBody, "attempts") {
		t.Fatalf("enterprise requests leaked %+v", reqBody)
	}
}

func TestConsolesRejectWrongRole(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	boss := newEnterpriseAdmin(t, srv, "acme", "acme-boss")
	mustCreateProject(t, boss, srv.URL, "billing")
	mustCreateUser(t, boss, srv.URL, map[string]string{
		"username": "acme-dev", "password": "dev-pass", "role": "developer",
	})
	mustAddMember(t, boss, srv.URL, "billing", "acme-dev")
	dev := loginUser(t, srv, "acme-dev", "dev-pass")

	mustStatus(t, getJSON(t, boss, srv.URL+"/platform/api/me"), http.StatusForbidden)
	mustStatus(t, getJSON(t, admin, srv.URL+"/enterprise/api/me"), http.StatusForbidden)
	mustStatus(t, getJSON(t, admin, srv.URL+"/team/api/me"), http.StatusForbidden)
	mustStatus(t, getJSON(t, boss, srv.URL+"/team/api/me"), http.StatusForbidden)
	mustStatus(t, getJSON(t, dev, srv.URL+"/enterprise/api/me"), http.StatusForbidden)
	mustStatus(t, getJSON(t, dev, srv.URL+"/platform/api/providers"), http.StatusForbidden)

	ok := getJSON(t, admin, srv.URL+"/platform/api/me")
	mustStatus(t, ok, http.StatusOK)
	_ = ok.Body.Close()
	ok = getJSON(t, boss, srv.URL+"/enterprise/api/me")
	mustStatus(t, ok, http.StatusOK)
	_ = ok.Body.Close()
	ok = getJSON(t, dev, srv.URL+"/team/api/me")
	mustStatus(t, ok, http.StatusOK)
	_ = ok.Body.Close()

	prov := getJSON(t, boss, srv.URL+"/enterprise/api/providers")
	mustStatus(t, prov, http.StatusForbidden)
	_ = prov.Body.Close()
	keys := getJSON(t, boss, srv.URL+"/enterprise/api/providers/ds/keys")
	mustStatus(t, keys, http.StatusForbidden)
	_ = keys.Body.Close()
}

func TestCallerSeesRequestIDAndRemainingHeaders(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	putJSON(t, admin, srv.URL+"/admin/api/projects/"+fabric.SeedTeam+"/rpm", map[string]int{"rpm": 10})
	putJSON(t, admin, srv.URL+"/admin/api/projects/"+fabric.SeedTeam+"/budget", map[string]float64{"daily_cny": 1})

	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader([]byte(`{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+fabric.SeedVirtualKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if id := resp.Header.Get("X-Fabric-Request-Id"); !strings.HasPrefix(id, "req-") {
		t.Fatalf("request id %q", id)
	}
	if headerFloat(t, resp.Header, "X-Fabric-RateLimit-Remaining") < 0 {
		t.Fatal("rate remaining")
	}
	if headerFloat(t, resp.Header, "X-Fabric-Budget-Remaining") > 1 {
		t.Fatal("budget remaining")
	}
}

func TestTeamDeveloperCannotAddDeveloper(t *testing.T) {
	srv := newTestServer(t)
	boss := newEnterpriseAdmin(t, srv, "acme", "acme-boss")
	mustCreateProject(t, boss, srv.URL, "billing")
	mustCreateUser(t, boss, srv.URL, map[string]string{
		"username": "acme-lead", "password": "lead-pass", "role": "team_admin",
	})
	mustCreateUser(t, boss, srv.URL, map[string]string{
		"username": "acme-dev", "password": "dev-pass", "role": "developer",
	})
	mustAddMember(t, boss, srv.URL, "billing", "acme-lead")
	mustAddMember(t, boss, srv.URL, "billing", "acme-dev")
	dev := loginUser(t, srv, "acme-dev", "dev-pass")
	lead := loginUser(t, srv, "acme-lead", "lead-pass")

	mustCreateUser(t, boss, srv.URL, map[string]string{
		"username": "acme-dev2", "password": "dev2-pass", "role": "developer",
	})
	resp := postJSON(t, dev, srv.URL+"/team/api/teams/billing/members", `{"username":"acme-dev2"}`)
	mustStatus(t, resp, http.StatusForbidden)
	_ = resp.Body.Close()
	resp = postJSON(t, lead, srv.URL+"/team/api/teams/billing/members", `{"username":"acme-dev2"}`)
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("lead add %d: %s", resp.StatusCode, b)
	}
	_ = resp.Body.Close()
}
