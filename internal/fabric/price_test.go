package fabric_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestAdminCanUpsertModelPrices(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	putPrice(t, admin, srv.URL, fabric.SeedModel, 10, 20, 1)

	got := getPrice(t, admin, srv.URL, fabric.SeedModel)
	if got.InputCNY != 10 || got.OutputCNY != 20 || got.CachedCNY != 1 {
		t.Fatalf("price %+v", got)
	}
}

func TestMissingPriceRejectsCall(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	if st := deletePrice(t, admin, srv.URL, fabric.SeedModel); st != http.StatusOK {
		t.Fatalf("delete %d", st)
	}
	calls := srv.ProviderCalls()
	status, body := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusBadRequest {
		t.Fatalf("status %d: %s", status, body)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("no-price call hit provider")
	}
}

func TestCostMatchesPricebookAndUsageReport(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	putPrice(t, admin, srv.URL, fabric.SeedModel, 10, 20, 1)

	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("chat %d", status)
	}
	// fixture usage 10 in / 20 out; cost = 10/1e6*10 + 20/1e6*20 = 0.0005
	const want = 0.0005
	rows := listRequestCosts(t, admin, srv.URL)
	if len(rows) != 1 || rows[0].CostCNY != want || rows[0].InputTokens != 10 {
		t.Fatalf("request %+v", rows)
	}
	usage := getUsageCost(t, admin, srv.URL)
	if usage != want {
		t.Fatalf("report cost %v want %v", usage, want)
	}
}

func TestZeroUsageRequestHasZeroCost(t *testing.T) {
	srv := newTestServer(t)
	// unknown path is 404 without a Request; use provider error by empty fixture stream?
	// A registered call that gets no usage: swap fixture body without usage.
	srv.provider.Body = []byte(`{"id":"nouse","choices":[]}`)
	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	admin := loginAdmin(t, srv)
	rows := listRequestCosts(t, admin, srv.URL)
	if len(rows) != 1 || rows[0].CostCNY != 0 || rows[0].InputTokens != 0 {
		t.Fatalf("zero-usage row %+v", rows)
	}
}

func putPrice(t *testing.T, admin *http.Client, base, model string, in, out, cached float64) {
	t.Helper()
	body, _ := json.Marshal(map[string]float64{"input_cny": in, "output_cny": out, "cached_cny": cached})
	req, err := http.NewRequest(http.MethodPut, base+"/admin/api/prices/"+model, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := admin.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("put price %d: %s", resp.StatusCode, b)
	}
}

func getPrice(t *testing.T, admin *http.Client, base, model string) fabric.Price {
	t.Helper()
	resp, err := admin.Get(base + "/admin/api/prices")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Prices []fabric.Price `json:"prices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	for _, p := range payload.Prices {
		if p.Model == model {
			return p
		}
	}
	t.Fatalf("no price for %s", model)
	return fabric.Price{}
}

func deletePrice(t *testing.T, admin *http.Client, base, model string) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodDelete, base+"/admin/api/prices/"+model, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := admin.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func listRequestCosts(t *testing.T, admin *http.Client, base string) []struct {
	InputTokens int     `json:"input_tokens"`
	CostCNY     float64 `json:"cost_cny"`
} {
	t.Helper()
	resp, err := admin.Get(base + "/admin/api/requests?project=demo")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Requests []struct {
			InputTokens int     `json:"input_tokens"`
			CostCNY     float64 `json:"cost_cny"`
		} `json:"requests"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	return payload.Requests
}

func getUsageCost(t *testing.T, admin *http.Client, base string) float64 {
	t.Helper()
	resp, err := admin.Get(base + "/admin/api/usage?project=demo&day=2026-08-17")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Rows []struct {
			CostCNY float64 `json:"cost_cny"`
		} `json:"rows"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Rows) != 1 {
		t.Fatalf("usage rows %+v", payload.Rows)
	}
	return payload.Rows[0].CostCNY
}
