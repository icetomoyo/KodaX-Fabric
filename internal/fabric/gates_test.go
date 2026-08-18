package fabric_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestVirtualKeyRPMRejectsWithoutCallingProvider(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	vk := createVK(t, admin, srv.URL, fabric.SeedTeam)
	putJSON(t, admin, srv.URL+"/admin/api/virtual-keys/"+vk.Hash+"/rpm", map[string]int{"rpm": 1})

	status, _ := postChat(t, srv, vk.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("first %d", status)
	}
	calls := srv.ProviderCalls()
	status, _ = postChat(t, srv, vk.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusTooManyRequests {
		t.Fatalf("second %d", status)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("429 hit provider")
	}
	rows := listRequests(t, admin, srv.URL)
	if len(rows) < 2 {
		t.Fatalf("want 429 on ledger %+v", rows)
	}
	var saw429 bool
	for _, r := range rows {
		if r.Status == http.StatusTooManyRequests && r.CostCNY == 0 && r.InputTokens == 0 {
			saw429 = true
		}
	}
	if !saw429 {
		t.Fatalf("missing 429 request %+v", rows)
	}
}

func TestTeamRPMRejectsWithoutCallingProvider(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	putJSON(t, admin, srv.URL+"/admin/api/projects/"+fabric.SeedTeam+"/rpm", map[string]int{"rpm": 1})
	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("first %d", status)
	}
	calls := srv.ProviderCalls()
	status, _ = postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusTooManyRequests {
		t.Fatalf("second %d", status)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("team 429 hit provider")
	}
}

func TestTeamHardBudgetRejectsAfterSpend(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	putJSON(t, admin, srv.URL+"/admin/api/projects/"+fabric.SeedTeam+"/budget", map[string]float64{"daily_cny": 0.00004})
	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("first %d", status)
	}
	calls := srv.ProviderCalls()
	status, _ = postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusPaymentRequired {
		t.Fatalf("second %d", status)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("402 hit provider")
	}
	rows := listRequests(t, admin, srv.URL)
	var saw402 bool
	for _, r := range rows {
		if r.Status == http.StatusPaymentRequired && r.CostCNY == 0 {
			saw402 = true
		}
	}
	if !saw402 {
		t.Fatalf("missing 402 request %+v", rows)
	}
}

func TestEnterpriseBudgetIsIndependent(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	putJSON(t, admin, srv.URL+"/admin/api/enterprises/"+fabric.SeedEnterprise+"/budget", map[string]float64{"daily_cny": 0.00004})
	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("first %d", status)
	}
	status, _ = postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusPaymentRequired {
		t.Fatalf("enterprise gate %d", status)
	}
}

func TestFailoverCountsOneRPM(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	setupTwoChannels(t, admin, srv.URL, "rpm-fail")
	putJSON(t, admin, srv.URL+"/admin/api/projects/"+fabric.SeedTeam+"/rpm", map[string]int{"rpm": 1})
	success := readFixture(t, "openai/chat_completion.json")
	srv.provider.Steps = []fabric.FixtureStep{
		{Status: http.StatusInternalServerError, Body: []byte(`{"error":"up"}`)},
		{Status: http.StatusOK, Body: success},
	}
	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"rpm-fail","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("failover %d", status)
	}
	if srv.ProviderCalls() != 2 {
		t.Fatalf("want 2 attempts, got %d", srv.ProviderCalls())
	}
	status, _ = postChat(t, srv, fabric.SeedVirtualKey, `{"model":"rpm-fail","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusTooManyRequests {
		t.Fatalf("second entry %d", status)
	}
}

func TestOpenChannelLeavesPoolAndHalfOpenAllowsOneProbe(t *testing.T) {
	srv := newTestServer(t)
	srv.app.HealthWindow = 2
	srv.app.HealthMinRate = 0.8
	srv.app.HealthOpenFor = 30 * time.Second
	admin := loginAdmin(t, srv)
	setupTwoChannels(t, admin, srv.URL, "health-pool")
	chs := listChannels(t, admin, srv.URL, "health-pool")
	// only keep high-priority path by disabling the backup after we know ids
	var high, low string
	for _, c := range chs {
		if c.Priority >= 10 {
			high = c.ID
		} else {
			low = c.ID
		}
	}
	if high == "" || low == "" {
		t.Fatalf("channels %+v", chs)
	}

	srv.provider.Steps = []fabric.FixtureStep{
		{Status: 500, Body: []byte(`{"error":"a"}`)},
		{Status: 200, Body: readFixture(t, "openai/chat_completion.json")},
		{Status: 500, Body: []byte(`{"error":"b"}`)},
		{Status: 200, Body: readFixture(t, "openai/chat_completion.json")},
	}
	// two entries: each fails high then succeeds on low → high has 2 failures → open
	for i := 0; i < 2; i++ {
		status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"health-pool","messages":[{"role":"user","content":"hi"}]}`)
		if status != http.StatusOK {
			t.Fatalf("warmup %d %d", i, status)
		}
	}
	calls := srv.ProviderCalls()
	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"health-pool","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("after open %d", status)
	}
	if srv.ProviderCalls() != calls+1 {
		t.Fatalf("open channel still probed: before %d after %d", calls, srv.ProviderCalls())
	}

	base := srv.app.Now()
	srv.app.Now = func() time.Time { return base.Add(31 * time.Second) }
	srv.provider.Delay = 80 * time.Millisecond
	startCalls := srv.ProviderCalls()
	done := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func() {
			st, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"health-pool","messages":[{"role":"user","content":"hi"}]}`)
			done <- st
		}()
	}
	<-done
	<-done
	probes := srv.ProviderCalls() - startCalls
	if probes != 2 {
		// one probe on high (half-open) + one on low, or only low if high probe not selected first...
		// high has higher priority; half-open allows 1. Second request treats high as open and uses low.
		// So 2 provider calls total (probe + backup) is expected if they serialize.
		// If concurrent, one probe + one backup = 2. If both try high, one probe one backup = 2.
		// 3 would mean half-open leaked a second probe onto high AND both also used low.
		if probes > 2 {
			t.Fatalf("half-open leaked probes %d", probes)
		}
	}
}

func putJSON(t *testing.T, admin *http.Client, url string, body any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(raw))
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
		t.Fatalf("PUT %s %d: %s", url, resp.StatusCode, b)
	}
}
