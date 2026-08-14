package hub_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"kodax-fabric/internal/hub"
	"kodax-fabric/internal/store"
)

func newConsole(t *testing.T) (*httptest.Server, *store.Memory, *http.Client) {
	t.Helper()
	st := &store.Memory{}
	st.SeedOperator("18612243416", "管理员", store.RoleAdmin, "Hz@123456")
	st.SeedOperator("13800138000", "开发者", store.RoleDeveloper, "Dev@123456")
	_, _ = st.CreatePool(nil, store.PoolCreate{Name: "default", GroupName: "standard"})
	srv := hub.New(st, http.DefaultClient)
	srv.Console = st
	srv.Sessions = hub.NewSessions()
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	jar, _ := cookiejar.New(nil)
	return ts, st, &http.Client{Jar: jar}
}

func login(t *testing.T, c *http.Client, base, phone, pass string) *http.Response {
	t.Helper()
	resp, err := c.Post(base+"/console/v1/login", "application/json", strings.NewReader(
		`{"phone":"`+phone+`","password":"`+pass+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func readBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}

func TestLoginSuccessAndMe(t *testing.T) {
	ts, _, c := newConsole(t)
	resp := login(t, c, ts.URL, "18612243416", "Hz@123456")
	body := readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("login %d %s", resp.StatusCode, body)
	}
	if !strings.Contains(body, `"role":"org_admin"`) {
		t.Fatalf("login body %s", body)
	}
	if strings.Contains(body, "password_hash") {
		t.Fatalf("hash leaked: %s", body)
	}
	me, err := c.Get(ts.URL + "/console/v1/me")
	if err != nil {
		t.Fatal(err)
	}
	raw := readBody(t, me)
	if me.StatusCode != 200 {
		t.Fatalf("me %d %s", me.StatusCode, raw)
	}
	if !strings.Contains(raw, "18612243416") {
		t.Fatalf("me %s", raw)
	}
}

func TestLoginBadPassword(t *testing.T) {
	ts, _, c := newConsole(t)
	resp := login(t, c, ts.URL, "18612243416", "wrong-pass")
	if resp.StatusCode != 401 {
		t.Fatalf("status %d %s", resp.StatusCode, readBody(t, resp))
	}
	_ = resp.Body.Close()
}

func TestDeveloperCannotListUsers(t *testing.T) {
	ts, _, c := newConsole(t)
	resp := login(t, c, ts.URL, "13800138000", "Dev@123456")
	if resp.StatusCode != 200 {
		t.Fatalf("login %d %s", resp.StatusCode, readBody(t, resp))
	}
	_ = resp.Body.Close()
	got, err := c.Get(ts.URL + "/console/v1/users")
	if err != nil {
		t.Fatal(err)
	}
	if got.StatusCode != 403 {
		t.Fatalf("status %d %s", got.StatusCode, readBody(t, got))
	}
	_ = got.Body.Close()
}

func TestAdminUserCRUD(t *testing.T) {
	ts, _, c := newConsole(t)
	resp := login(t, c, ts.URL, "18612243416", "Hz@123456")
	if resp.StatusCode != 200 {
		t.Fatal(readBody(t, resp))
	}
	_ = resp.Body.Close()

	created, err := c.Post(ts.URL+"/console/v1/users", "application/json", strings.NewReader(
		`{"phone":"13900001111","name":"小王","role":"developer","password":"Passw0rd!"}`))
	if err != nil {
		t.Fatal(err)
	}
	raw := readBody(t, created)
	if created.StatusCode != 201 {
		t.Fatalf("create %d %s", created.StatusCode, raw)
	}
	if strings.Contains(raw, "password") && strings.Contains(raw, "Passw0rd") {
		t.Fatalf("password leaked: %s", raw)
	}
	var wrap struct {
		User store.Operator `json:"user"`
	}
	if err := json.Unmarshal([]byte(raw), &wrap); err != nil {
		t.Fatal(err)
	}

	req, _ := http.NewRequest(http.MethodPatch, ts.URL+"/console/v1/users/"+itoa(wrap.User.ID), strings.NewReader(`{"status":"disabled"}`))
	req.Header.Set("Content-Type", "application/json")
	patched, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if patched.StatusCode != 200 {
		t.Fatalf("patch %d %s", patched.StatusCode, readBody(t, patched))
	}
	_ = patched.Body.Close()

	bad := login(t, http.DefaultClient, ts.URL, "13900001111", "Passw0rd!")
	if bad.StatusCode != 401 {
		t.Fatalf("disabled user login %d", bad.StatusCode)
	}
	_ = bad.Body.Close()
}

func TestCannotDisableLastAdmin(t *testing.T) {
	ts, st, c := newConsole(t)
	resp := login(t, c, ts.URL, "18612243416", "Hz@123456")
	_ = readBody(t, resp)
	adminID := st.Operators[0].ID
	req, _ := http.NewRequest(http.MethodPatch, ts.URL+"/console/v1/users/"+itoa(adminID), strings.NewReader(`{"status":"disabled"}`))
	req.Header.Set("Content-Type", "application/json")
	got, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if got.StatusCode != 403 {
		t.Fatalf("status %d %s", got.StatusCode, readBody(t, got))
	}
	_ = got.Body.Close()
}

func TestProviderKeyNeverLeaksSecret(t *testing.T) {
	ts, _, c := newConsole(t)
	_ = readBody(t, login(t, c, ts.URL, "18612243416", "Hz@123456"))
	created, err := c.Post(ts.URL+"/console/v1/provider-keys", "application/json", strings.NewReader(
		`{"provider_code":"deepseek","secret":"sk-super-secret-fixture"}`))
	if err != nil {
		t.Fatal(err)
	}
	raw := readBody(t, created)
	if created.StatusCode != 201 {
		t.Fatalf("create %d %s", created.StatusCode, raw)
	}
	if strings.Contains(raw, "sk-super-secret-fixture") || strings.Contains(raw, "secret_encrypted") {
		t.Fatalf("secret leaked: %s", raw)
	}
	listed, err := c.Get(ts.URL + "/console/v1/provider-keys")
	if err != nil {
		t.Fatal(err)
	}
	lraw := readBody(t, listed)
	if strings.Contains(lraw, "sk-super-secret-fixture") {
		t.Fatalf("list leaked secret: %s", lraw)
	}
}

func TestCreateVKPlaintextOnce(t *testing.T) {
	ts, _, c := newConsole(t)
	_ = readBody(t, login(t, c, ts.URL, "18612243416", "Hz@123456"))
	if tr, err := c.Post(ts.URL+"/console/v1/teams", "application/json", strings.NewReader(`{"name":"t0"}`)); err != nil {
		t.Fatal(err)
	} else if tr.StatusCode != 201 {
		t.Fatalf("team %d %s", tr.StatusCode, readBody(t, tr))
	} else {
		_ = readBody(t, tr)
	}
	if pr, err := c.Post(ts.URL+"/console/v1/projects", "application/json", strings.NewReader(`{"name":"p0","team_id":1}`)); err != nil {
		t.Fatal(err)
	} else if pr.StatusCode != 201 {
		t.Fatalf("project %d %s", pr.StatusCode, readBody(t, pr))
	} else {
		_ = readBody(t, pr)
	}
	if po, err := c.Post(ts.URL+"/console/v1/pools", "application/json", strings.NewReader(`{"name":"p-issue","group_name":"standard","team_id":1}`)); err != nil {
		t.Fatal(err)
	} else if po.StatusCode != 201 {
		t.Fatalf("pool %d %s", po.StatusCode, readBody(t, po))
	} else {
		_ = readBody(t, po)
	}
	if ur, err := c.Post(ts.URL+"/console/v1/users", "application/json", strings.NewReader(
		`{"phone":"13900007777","name":"持有人","role":"developer","password":"Dev@12345","team_id":1}`)); err != nil {
		t.Fatal(err)
	} else if ur.StatusCode != 201 {
		t.Fatalf("holder %d %s", ur.StatusCode, readBody(t, ur))
	} else {
		_ = readBody(t, ur)
	}
	created, err := c.Post(ts.URL+"/console/v1/virtual-keys", "application/json", strings.NewReader(
		`{"pool_id":2,"project_id":1,"owner_id":3}`))
	if err != nil {
		t.Fatal(err)
	}
	raw := readBody(t, created)
	if created.StatusCode != 201 {
		t.Fatalf("create %d %s", created.StatusCode, raw)
	}
	var vk store.VirtualKeyCreated
	if err := json.Unmarshal([]byte(raw), &vk); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(vk.Secret, "fab-") {
		t.Fatalf("missing secret: %s", raw)
	}
	listed, err := c.Get(ts.URL + "/console/v1/virtual-keys")
	if err != nil {
		t.Fatal(err)
	}
	lraw := readBody(t, listed)
	if strings.Contains(lraw, vk.Secret) {
		t.Fatalf("plaintext listed again: %s", lraw)
	}

	dev := &http.Client{}
	jar, _ := cookiejar.New(nil)
	dev.Jar = jar
	_ = readBody(t, login(t, dev, ts.URL, "13900007777", "Dev@12345"))
	mine, err := dev.Get(ts.URL + "/console/v1/me/keys")
	if err != nil {
		t.Fatal(err)
	}
	mraw := readBody(t, mine)
	if mine.StatusCode != 200 {
		t.Fatalf("me/keys %d %s", mine.StatusCode, mraw)
	}
	if !strings.Contains(mraw, vk.KeyPrefix) {
		t.Fatalf("dev should see own key: %s", mraw)
	}
	if strings.Contains(mraw, vk.Secret) {
		t.Fatalf("dev saw plaintext: %s", mraw)
	}
}

func TestTeamProjectBindOnCatalog(t *testing.T) {
	ts, _, c := newConsole(t)
	_ = readBody(t, login(t, c, ts.URL, "18612243416", "Hz@123456"))

	teamResp, err := c.Post(ts.URL+"/console/v1/teams", "application/json", strings.NewReader(`{"name":"研发"}`))
	if err != nil {
		t.Fatal(err)
	}
	traw := readBody(t, teamResp)
	if teamResp.StatusCode != 201 {
		t.Fatalf("team %d %s", teamResp.StatusCode, traw)
	}
	var team store.TeamView
	if err := json.Unmarshal([]byte(traw), &team); err != nil {
		t.Fatal(err)
	}

	projResp, err := c.Post(ts.URL+"/console/v1/projects", "application/json", strings.NewReader(
		`{"team_id":`+itoa(team.ID)+`,"name":"网关"}`))
	if err != nil {
		t.Fatal(err)
	}
	praw := readBody(t, projResp)
	if projResp.StatusCode != 201 {
		t.Fatalf("project %d %s", projResp.StatusCode, praw)
	}
	var proj store.ProjectView
	if err := json.Unmarshal([]byte(praw), &proj); err != nil {
		t.Fatal(err)
	}

	poolResp, err := c.Post(ts.URL+"/console/v1/pools", "application/json", strings.NewReader(
		`{"name":"vip","group_name":"premium","team_id":`+itoa(team.ID)+`}`))
	if err != nil {
		t.Fatal(err)
	}
	poolRaw := readBody(t, poolResp)
	if poolResp.StatusCode != 201 || !strings.Contains(poolRaw, `"team_id":`+itoa(team.ID)) {
		t.Fatalf("pool %d %s", poolResp.StatusCode, poolRaw)
	}
	var pool store.PoolView
	if err := json.Unmarshal([]byte(poolRaw), &pool); err != nil {
		t.Fatal(err)
	}

	pkResp, err := c.Post(ts.URL+"/console/v1/provider-keys", "application/json", strings.NewReader(
		`{"provider_code":"openai","secret":"sk-team-a","team_id":`+itoa(team.ID)+`}`))
	if err != nil {
		t.Fatal(err)
	}
	pkRaw := readBody(t, pkResp)
	if pkResp.StatusCode != 201 || strings.Contains(pkRaw, "sk-team-a") || !strings.Contains(pkRaw, `"team_id":`+itoa(team.ID)) {
		t.Fatalf("pk %d %s", pkResp.StatusCode, pkRaw)
	}

	vkResp, err := c.Post(ts.URL+"/console/v1/virtual-keys", "application/json", strings.NewReader(
		`{"pool_id":`+itoa(pool.ID)+`,"owner_id":2,"project_id":`+itoa(proj.ID)+`}`))
	if err != nil {
		t.Fatal(err)
	}
	vkRaw := readBody(t, vkResp)
	if vkResp.StatusCode != 201 || !strings.Contains(vkRaw, `"project_id":`+itoa(proj.ID)) {
		t.Fatalf("vk %d %s", vkResp.StatusCode, vkRaw)
	}

	dev := &http.Client{}
	jar, _ := cookiejar.New(nil)
	dev.Jar = jar
	_ = readBody(t, login(t, dev, ts.URL, "13800138000", "Dev@123456"))
	denied, err := dev.Post(ts.URL+"/console/v1/teams", "application/json", strings.NewReader(`{"name":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	if denied.StatusCode != 403 {
		t.Fatalf("dev create team %d %s", denied.StatusCode, readBody(t, denied))
	}
}

func TestRouteDecisionsListed(t *testing.T) {
	ts, st, c := newConsole(t)
	_ = readBody(t, login(t, c, ts.URL, "18612243416", "Hz@123456"))
	if err := st.SaveRouteDecision(nil, store.RouteDecision{
		RequestID: "req-1", ChannelID: 7, Reason: "priority", PoolGroup: "premium",
	}); err != nil {
		t.Fatal(err)
	}
	resp, err := c.Get(ts.URL + "/console/v1/route-decisions")
	if err != nil {
		t.Fatal(err)
	}
	raw := readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("status %d %s", resp.StatusCode, raw)
	}
	if !strings.Contains(raw, "req-1") || !strings.Contains(raw, "premium") {
		t.Fatalf("audit %s", raw)
	}
}

func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}
