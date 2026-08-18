package fabric_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestUsageReportSplitsProjectsAndSumsTokens(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	mustCreateProject(t, admin, srv.URL, "billing")
	vkDemo := createVK(t, admin, srv.URL, fabric.SeedProject)
	vkBill := createVK(t, admin, srv.URL, "billing")

	if st, _ := postChat(t, srv, vkDemo.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"a"}]}`); st != 200 {
		t.Fatalf("demo1 %d", st)
	}
	if st, _ := postChat(t, srv, vkDemo.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"b"}]}`); st != 200 {
		t.Fatalf("demo2 %d", st)
	}
	if st, _ := postChat(t, srv, vkBill.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"c"}]}`); st != 200 {
		t.Fatalf("bill %d", st)
	}

	demo := usageCell(t, admin, srv.URL, "demo", "2026-08-17", "gpt-4o-mini")
	bill := usageCell(t, admin, srv.URL, "billing", "2026-08-17", "gpt-4o-mini")
	if demo.Calls != 2 || bill.Calls != 1 {
		t.Fatalf("calls demo=%+v bill=%+v", demo, bill)
	}
	if demo.InputTokens != 20 || demo.OutputTokens != 40 {
		t.Fatalf("demo tokens %+v", demo)
	}
	if bill.InputTokens != 10 || bill.OutputTokens != 20 {
		t.Fatalf("bill tokens %+v", bill)
	}
	if demo.CostCNY != 0.0001 || bill.CostCNY != 0.00005 {
		t.Fatalf("cost demo=%v bill=%v", demo.CostCNY, bill.CostCNY)
	}

	all := usageRows(t, admin, srv.URL, "", "2026-08-17")
	if len(all) != 2 {
		t.Fatalf("all cells %+v", all)
	}

	createProvider(t, admin, srv.URL, "ds", "openai", "https://example.invalid", "sk-x")
	createModel(t, admin, srv.URL, "other-model", "openai", "ds")
	putPrice(t, admin, srv.URL, "other-model", 1, 2, 0.1)
	if st, _ := postChat(t, srv, vkDemo.Plaintext, `{"model":"other-model","messages":[{"role":"user","content":"d"}]}`); st != 200 {
		t.Fatalf("other model %d", st)
	}
	other := usageCell(t, admin, srv.URL, "demo", "2026-08-17", "other-model")
	if other.Calls != 1 || usageCell(t, admin, srv.URL, "demo", "2026-08-17", "gpt-4o-mini").Calls != 2 {
		t.Fatalf("model cells mixed: other=%+v", other)
	}
}

func TestUsageReportShanghaiDayBoundary(t *testing.T) {
	srv := newTestServer(t)
	shanghai := time.FixedZone("CST", 8*3600)
	// 2026-08-16 23:30 Shanghai
	srv.app.Now = func() time.Time { return time.Date(2026, 8, 16, 23, 30, 0, 0, shanghai) }
	if st, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"a"}]}`); st != 200 {
		t.Fatalf("before midnight %d", st)
	}
	// 2026-08-17 00:30 Shanghai
	srv.app.Now = func() time.Time { return time.Date(2026, 8, 17, 0, 30, 0, 0, shanghai) }
	if st, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"b"}]}`); st != 200 {
		t.Fatalf("after midnight %d", st)
	}
	admin := loginAdmin(t, srv)
	d16 := usageCell(t, admin, srv.URL, "demo", "2026-08-16", "gpt-4o-mini")
	d17 := usageCell(t, admin, srv.URL, "demo", "2026-08-17", "gpt-4o-mini")
	if d16.Calls != 1 || d17.Calls != 1 {
		t.Fatalf("day split 16=%+v 17=%+v", d16, d17)
	}
}

func TestUsageReportCountsFailuresWithoutFreeSuccessCost(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	if st, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ok"}]}`); st != 200 {
		t.Fatalf("ok %d", st)
	}
	srv.provider.Status = http.StatusBadGateway
	srv.provider.Body = []byte(`{}`)
	if st, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"fail"}]}`); st != http.StatusBadGateway {
		t.Fatalf("fail %d", st)
	}
	srv.provider.Status = 0
	srv.provider.Body = []byte(`{"id":"nouse","choices":[]}`)
	if st, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"empty"}]}`); st != 200 {
		t.Fatalf("empty %d", st)
	}

	cell := usageCell(t, admin, srv.URL, "demo", "2026-08-17", "gpt-4o-mini")
	if cell.Calls != 3 {
		t.Fatalf("calls %+v", cell)
	}
	if cell.FailedCalls != 1 {
		t.Fatalf("failed %+v", cell)
	}
	if cell.ZeroUsageCalls != 1 {
		t.Fatalf("zero-usage %+v", cell)
	}
	if cell.CostCNY != 0.00005 {
		t.Fatalf("cost should be success only, got %v", cell.CostCNY)
	}
	if cell.InputTokens != 10 || cell.OutputTokens != 20 {
		t.Fatalf("tokens should be success usage only %+v", cell)
	}
}

type usageView struct {
	Project        string  `json:"project"`
	Model          string  `json:"model"`
	Day            string  `json:"day"`
	Calls          int     `json:"calls"`
	FailedCalls    int     `json:"failed_calls"`
	ZeroUsageCalls int     `json:"zero_usage_calls"`
	InputTokens    int     `json:"input_tokens"`
	OutputTokens   int     `json:"output_tokens"`
	CostCNY        float64 `json:"cost_cny"`
}

func usageRows(t *testing.T, admin *http.Client, base, project, day string) []usageView {
	t.Helper()
	u := base + "/admin/api/usage?day=" + day
	if project != "" {
		u += "&project=" + project
	}
	resp, err := admin.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Rows []usageView `json:"rows"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	return payload.Rows
}

func usageCell(t *testing.T, admin *http.Client, base, project, day, model string) usageView {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		for _, row := range usageRows(t, admin, base, project, day) {
			if row.Project == project && row.Model == model && row.Day == day {
				return row
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("no cell %s %s %s", project, model, day)
	return usageView{}
}
