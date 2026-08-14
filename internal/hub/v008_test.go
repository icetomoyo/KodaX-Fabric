package hub_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"kodax-fabric/internal/hub"
	"kodax-fabric/internal/store"
)

func TestCacheableSecondRequestHits(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"},
		}},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	body := `{"model":"gpt-4","messages":[{"role":"user","content":"translate hi"}]}`
	post := func(cacheable bool) *http.Response {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+testVK)
		if cacheable {
			req.Header.Set("X-Fabric-Cacheable", "true")
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	resp := post(true)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("first %d", resp.StatusCode)
	}
	resp = post(true)
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("second %d %s", resp.StatusCode, raw)
	}
	if resp.Header.Get("X-Fabric-Cache") != "hit" {
		t.Fatalf("cache header %q", resp.Header.Get("X-Fabric-Cache"))
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d want 1", hits)
	}

	resp = post(false)
	_ = resp.Body.Close()
	if atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("unmarked should miss, hits %d", hits)
	}
}

func TestPromptCacheFieldsPassThrough(t *testing.T) {
	var got string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got = string(b)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"}})
	t.Cleanup(gw.Close)
	body := `{"model":"gpt-4","messages":[{"role":"user","content":"hi","cache_control":{"type":"ephemeral"}}]}`
	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if !strings.Contains(got, `"cache_control"`) {
		t.Fatalf("prompt cache field stripped: %s", got)
	}
}

func TestStreamNeverCached(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n")
	}))
	t.Cleanup(up.Close)
	gw := newGateway(t, []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"}})
	t.Cleanup(gw.Close)
	for i := 0; i < 2; i++ {
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4","stream":true}`))
		req.Header.Set("Authorization", "Bearer "+testVK)
		req.Header.Set("X-Fabric-Cacheable", "true")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.Header.Get("X-Fabric-Cache") == "hit" {
			t.Fatal("stream must not hit cache")
		}
	}
	if atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("stream hits %d", hits)
	}
}

func TestPendingVKAndIPAllow(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-pending": {
			VirtualKeyID: 1, PoolID: 1, Status: store.StatusPending,
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"}},
		},
		"fab-ip": {
			VirtualKeyID: 2, PoolID: 1, IPAllow: []string{"10.0.0.8"},
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"}},
		},
		"fab-open": {
			VirtualKeyID: 3, PoolID: 1,
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"}},
		},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-pending")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode == 200 {
		t.Fatal("pending VK should not pass")
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-ip")
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("bad ip status %d", resp.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer fab-open")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("open ip %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d want 1", hits)
	}
}

func TestSpoofedForwardedForDoesNotBypassIPAllow(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		"fab-ip": {
			VirtualKeyID: 1, PoolID: 1, IPAllow: []string{"1.2.3.4"},
			Channels: []store.Channel{{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk"}},
		},
	}}

	post := func(s *hub.Server) int {
		gw := httptest.NewServer(s.Handler())
		t.Cleanup(gw.Close)
		req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
		req.Header.Set("Authorization", "Bearer fab-ip")
		req.Header.Set("X-Forwarded-For", "1.2.3.4")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}

	plain := hub.New(st, http.DefaultClient)
	if got := post(plain); got != 403 {
		t.Fatalf("untrusted XFF status %d want 403", got)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("untrusted XFF hit upstream %d", hits)
	}

	trusted := hub.New(st, http.DefaultClient)
	trusted.TrustProxy = true
	if got := post(trusted); got != 200 {
		t.Fatalf("trusted XFF status %d want 200", got)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("trusted XFF hits %d", hits)
	}
}

func TestApplyApproveVKOnce(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(up.Close)
	ts, st, admin := newConsole(t)
	_ = readBody(t, login(t, admin, ts.URL, "18612243416", "Hz@123456"))

	dev := &http.Client{}
	jar, _ := cookiejar.New(nil)
	dev.Jar = jar

	if tr, err := admin.Post(ts.URL+"/console/v1/teams", "application/json", strings.NewReader(`{"name":"t0"}`)); err != nil {
		t.Fatal(err)
	} else if tr.StatusCode != 201 {
		t.Fatalf("team %d %s", tr.StatusCode, readBody(t, tr))
	} else {
		_ = readBody(t, tr)
	}
	if pr, err := admin.Post(ts.URL+"/console/v1/projects", "application/json", strings.NewReader(`{"name":"p0","team_id":1}`)); err != nil {
		t.Fatal(err)
	} else if pr.StatusCode != 201 {
		t.Fatalf("project %d %s", pr.StatusCode, readBody(t, pr))
	} else {
		_ = readBody(t, pr)
	}
	if po, err := admin.Post(ts.URL+"/console/v1/pools", "application/json", strings.NewReader(`{"name":"p-apply","group_name":"standard","team_id":1}`)); err != nil {
		t.Fatal(err)
	} else if po.StatusCode != 201 {
		t.Fatalf("pool %d %s", po.StatusCode, readBody(t, po))
	} else {
		_ = readBody(t, po)
	}
	if ur, err := admin.Post(ts.URL+"/console/v1/users", "application/json", strings.NewReader(
		`{"phone":"13900008888","name":"申请人","role":"developer","password":"Dev@12345","team_id":1}`)); err != nil {
		t.Fatal(err)
	} else if ur.StatusCode != 201 {
		t.Fatalf("user %d %s", ur.StatusCode, readBody(t, ur))
	} else {
		_ = readBody(t, ur)
	}
	_ = readBody(t, login(t, dev, ts.URL, "13900008888", "Dev@12345"))
	applied, err := dev.Post(ts.URL+"/console/v1/vk-requests", "application/json", strings.NewReader(`{"pool_id":2,"project_id":1}`))
	if err != nil {
		t.Fatal(err)
	}
	araw := readBody(t, applied)
	if applied.StatusCode != 201 {
		t.Fatalf("apply %d %s", applied.StatusCode, araw)
	}
	var probe map[string]any
	if err := json.Unmarshal([]byte(araw), &probe); err != nil {
		t.Fatal(err)
	}
	if _, ok := probe["secret"]; ok {
		t.Fatalf("secret on apply: %s", araw)
	}
	var view store.VirtualKeyView
	if err := json.Unmarshal([]byte(araw), &view); err != nil {
		t.Fatal(err)
	}

	ok, err := admin.Post(ts.URL+"/console/v1/vk-requests/"+itoa(view.ID)+"/approve", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	okraw := readBody(t, ok)
	if ok.StatusCode != 200 {
		t.Fatalf("approve %d %s", ok.StatusCode, okraw)
	}
	var created store.VirtualKeyCreated
	if err := json.Unmarshal([]byte(okraw), &created); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(created.Secret, "fab-") {
		t.Fatalf("approve missing secret %s", okraw)
	}

	// wire relay channel for this VK
	if vk := st.ByRawKey[created.Secret]; vk != nil {
		vk.Channels = []store.Channel{{
			ID: 99, Protocol: store.ProtocolOpenAI, BaseURL: up.URL, Secret: "sk",
			PoolID: vk.PoolID, TeamID: vk.TeamID, KeyTeamID: vk.TeamID,
		}}
	}

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+created.Secret)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("approved vk %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits %d", hits)
	}
}

func TestRotateProviderKeySameVK(t *testing.T) {
	var hitOld, hitNew int32
	oldUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hitOld, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(oldUp.Close)
	newUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hitNew, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(openaiUsageBody()))
	}))
	t.Cleanup(newUp.Close)

	st := &store.Memory{ByRawKey: map[string]*store.ResolvedVK{
		testVK: {VirtualKeyID: 1, PoolID: 1, Channels: []store.Channel{
			{ID: 1, Protocol: store.ProtocolOpenAI, BaseURL: oldUp.URL, Secret: "sk-old", Priority: 1},
			{ID: 2, Protocol: store.ProtocolOpenAI, BaseURL: newUp.URL, Secret: "sk-new", Priority: 2},
		}},
	}}
	s := hub.New(st, http.DefaultClient)
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 || atomic.LoadInt32(&hitOld) != 1 {
		t.Fatalf("before rotate old=%d new=%d", hitOld, hitNew)
	}

	if err := st.DisableProviderKey(nil, 1); err != nil {
		t.Fatal(err)
	}
	req, _ = http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	req.Header.Set("Authorization", "Bearer "+testVK)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("after rotate %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&hitOld) != 1 || atomic.LoadInt32(&hitNew) != 1 {
		t.Fatalf("after rotate old=%d new=%d", hitOld, hitNew)
	}
}
