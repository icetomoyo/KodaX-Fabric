package hub_test

import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"
)

func TestLegacyAdminLoginIsOrgAdmin(t *testing.T) {
	ts, _, c := newConsole(t)
	resp := login(t, c, ts.URL, "18612243416", "Hz@123456")
	body := readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("login %d %s", resp.StatusCode, body)
	}
	if !strings.Contains(body, `"role":"org_admin"`) {
		t.Fatalf("want org_admin in login: %s", body)
	}
	me, err := c.Get(ts.URL + "/console/v1/me")
	if err != nil {
		t.Fatal(err)
	}
	raw := readBody(t, me)
	if me.StatusCode != 200 {
		t.Fatalf("me %d %s", me.StatusCode, raw)
	}
	if !strings.Contains(raw, `"role":"org_admin"`) {
		t.Fatalf("me want org_admin: %s", raw)
	}
}

func TestCreateTeamAdminRequiresTeam(t *testing.T) {
	ts, _, c := newConsole(t)
	_ = readBody(t, login(t, c, ts.URL, "18612243416", "Hz@123456"))

	noTeam, err := c.Post(ts.URL+"/console/v1/users", "application/json", strings.NewReader(
		`{"phone":"13900000001","name":"队长","role":"team_admin","password":"Team@1234"}`))
	if err != nil {
		t.Fatal(err)
	}
	raw := readBody(t, noTeam)
	if noTeam.StatusCode != 400 {
		t.Fatalf("no team_id status %d %s", noTeam.StatusCode, raw)
	}

	team, err := c.Post(ts.URL+"/console/v1/teams", "application/json", strings.NewReader(`{"name":"A队"}`))
	if err != nil {
		t.Fatal(err)
	}
	tbody := readBody(t, team)
	if team.StatusCode != 201 {
		t.Fatalf("create team %d %s", team.StatusCode, tbody)
	}

	ok, err := c.Post(ts.URL+"/console/v1/users", "application/json", strings.NewReader(
		`{"phone":"13900000002","name":"队长","role":"team_admin","password":"Team@1234","team_id":1}`))
	if err != nil {
		t.Fatal(err)
	}
	obody := readBody(t, ok)
	if ok.StatusCode != 201 {
		t.Fatalf("with team_id status %d %s", ok.StatusCode, obody)
	}
	if !strings.Contains(obody, `"role":"team_admin"`) {
		t.Fatalf("want team_admin: %s", obody)
	}
	if !strings.Contains(obody, `"team_id":1`) {
		t.Fatalf("want team_id 1: %s", obody)
	}
}

func TestAppRedirectsToAdmin(t *testing.T) {
	ts, _, c := newConsole(t)
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}
	resp, err := c.Get(ts.URL + "/app")
	if err != nil {
		t.Fatal(err)
	}
	raw := readBody(t, resp)
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("GET /app %d %s", resp.StatusCode, raw)
	}
	loc := resp.Header.Get("Location")
	if loc != "/admin" {
		t.Fatalf("Location %q want /admin", loc)
	}
}

func TestPaveRoutesOrgAdminOnly(t *testing.T) {
	ts, _, admin := newConsole(t)
	_ = readBody(t, login(t, admin, ts.URL, "18612243416", "Hz@123456"))

	dev := newClient()
	_ = readBody(t, login(t, dev, ts.URL, "13800138000", "Dev@123456"))

	if raw := readBody(t, postJSON(t, admin, ts.URL+"/console/v1/teams", `{"name":"A队"}`)); !strings.Contains(raw, `"id"`) {
		t.Fatalf("create team %s", raw)
	}
	created := postJSON(t, admin, ts.URL+"/console/v1/users",
		`{"phone":"13900001111","name":"队长A","role":"team_admin","password":"Team@1234","team_id":1}`)
	if created.StatusCode != 201 {
		t.Fatalf("create captain %d %s", created.StatusCode, readBody(t, created))
	}
	_ = readBody(t, created)
	captain := newClient()
	_ = readBody(t, login(t, captain, ts.URL, "13900001111", "Team@1234"))

	paths := []struct {
		method, path string
	}{
		{"GET", "/console/v1/provider-keys"},
		{"POST", "/console/v1/provider-keys"},
		{"GET", "/console/v1/channels"},
		{"POST", "/console/v1/channels"},
		{"GET", "/console/v1/model-aliases"},
		{"PUT", "/console/v1/model-aliases"},
	}
	for _, who := range []*http.Client{dev, captain} {
		for _, p := range paths {
			req, err := http.NewRequest(p.method, ts.URL+p.path, strings.NewReader(`{}`))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Content-Type", "application/json")
			resp, err := who.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			raw := readBody(t, resp)
			if resp.StatusCode != http.StatusForbidden {
				t.Fatalf("%s %s status %d %s", p.method, p.path, resp.StatusCode, raw)
			}
		}
	}
	for _, p := range []string{"/console/v1/provider-keys", "/console/v1/channels", "/console/v1/model-aliases"} {
		resp, err := admin.Get(ts.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		raw := readBody(t, resp)
		if resp.StatusCode != 200 {
			t.Fatalf("org_admin GET %s %d %s", p, resp.StatusCode, raw)
		}
	}
}

func TestCaptainSeesOnlyOwnTeam(t *testing.T) {
	ts, _, admin := newConsole(t)
	_ = readBody(t, login(t, admin, ts.URL, "18612243416", "Hz@123456"))

	if st := postJSON(t, admin, ts.URL+"/console/v1/teams", `{"name":"A队"}`); st.StatusCode != 201 {
		t.Fatalf("team A %d %s", st.StatusCode, readBody(t, st))
	} else {
		_ = readBody(t, st)
	}
	if st := postJSON(t, admin, ts.URL+"/console/v1/teams", `{"name":"B队"}`); st.StatusCode != 201 {
		t.Fatalf("team B %d %s", st.StatusCode, readBody(t, st))
	} else {
		_ = readBody(t, st)
	}
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/projects", `{"name":"PA","team_id":1}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/projects", `{"name":"PB","team_id":2}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/pools", `{"name":"pool-a","group_name":"standard","team_id":1}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/pools", `{"name":"pool-b","group_name":"standard","team_id":2}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/users",
		`{"phone":"13900001001","name":"队长A","role":"team_admin","password":"Team@1234","team_id":1}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/users",
		`{"phone":"13900001002","name":"队长B","role":"team_admin","password":"Team@1234","team_id":2}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/users",
		`{"phone":"13900001003","name":"开发A","role":"developer","password":"Dev@12345","team_id":1}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/virtual-keys", `{"pool_id":2,"project_id":1}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/virtual-keys", `{"pool_id":3,"project_id":2}`), 201)

	a := newClient()
	_ = readBody(t, login(t, a, ts.URL, "13900001001", "Team@1234"))
	dev := newClient()
	_ = readBody(t, login(t, dev, ts.URL, "13900001003", "Dev@12345"))

	users := getJSON(t, a, ts.URL+"/console/v1/users")
	if strings.Contains(users, "队长B") || strings.Contains(users, "13900001002") {
		t.Fatalf("captain A saw team B user: %s", users)
	}
	if !strings.Contains(users, "队长A") {
		t.Fatalf("captain A missing self: %s", users)
	}

	pools := getJSON(t, a, ts.URL+"/console/v1/pools")
	if strings.Contains(pools, "pool-b") {
		t.Fatalf("captain A saw pool B: %s", pools)
	}
	if !strings.Contains(pools, "pool-a") {
		t.Fatalf("captain A missing pool A: %s", pools)
	}

	projects := getJSON(t, a, ts.URL+"/console/v1/projects")
	if strings.Contains(projects, `"name":"PB"`) {
		t.Fatalf("captain A saw project B: %s", projects)
	}

	vks := getJSON(t, a, ts.URL+"/console/v1/virtual-keys")
	if strings.Contains(vks, `"pool_id":3`) {
		t.Fatalf("captain A saw B VK: %s", vks)
	}

	patch := patchJSON(t, a, ts.URL+"/console/v1/users/4", `{"name":"hack"}`)
	if patch.StatusCode != http.StatusForbidden && patch.StatusCode != http.StatusNotFound {
		t.Fatalf("patch B user %d %s", patch.StatusCode, readBody(t, patch))
	}
	_ = readBody(t, patch)

	steal := postJSON(t, a, ts.URL+"/console/v1/pools", `{"name":"stolen","group_name":"standard","team_id":2}`)
	if steal.StatusCode != http.StatusForbidden && steal.StatusCode != http.StatusBadRequest {
		t.Fatalf("create B pool %d %s", steal.StatusCode, readBody(t, steal))
	}
	_ = readBody(t, steal)

	// developer listing virtual-keys is own-only (none issued to them)
	own := getJSON(t, dev, ts.URL+"/console/v1/virtual-keys")
	if strings.Contains(own, `"pool_id":2`) || strings.Contains(own, `"pool_id":3`) {
		t.Fatalf("developer saw others' VK: %s", own)
	}
}

func TestIssueVKRequiresSameTeam(t *testing.T) {
	ts, _, admin := newConsole(t)
	_ = readBody(t, login(t, admin, ts.URL, "18612243416", "Hz@123456"))
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/teams", `{"name":"A队"}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/teams", `{"name":"B队"}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/projects", `{"name":"PA","team_id":1}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/projects", `{"name":"PB","team_id":2}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/pools", `{"name":"pool-a","group_name":"standard","team_id":1}`), 201)

	missing := postJSON(t, admin, ts.URL+"/console/v1/virtual-keys", `{"pool_id":2}`)
	if missing.StatusCode != 400 {
		t.Fatalf("missing project %d %s", missing.StatusCode, readBody(t, missing))
	}
	_ = readBody(t, missing)

	cross := postJSON(t, admin, ts.URL+"/console/v1/virtual-keys", `{"pool_id":2,"project_id":2}`)
	if cross.StatusCode != 400 {
		t.Fatalf("cross team %d %s", cross.StatusCode, readBody(t, cross))
	}
	_ = readBody(t, cross)

	ok := postJSON(t, admin, ts.URL+"/console/v1/virtual-keys", `{"pool_id":2,"project_id":1}`)
	if ok.StatusCode != 201 {
		t.Fatalf("same team %d %s", ok.StatusCode, readBody(t, ok))
	}
	_ = readBody(t, ok)
}

func TestDeveloperMustApplyVK(t *testing.T) {
	ts, _, admin := newConsole(t)
	_ = readBody(t, login(t, admin, ts.URL, "18612243416", "Hz@123456"))
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/teams", `{"name":"A队"}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/teams", `{"name":"B队"}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/projects", `{"name":"PA","team_id":1}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/projects", `{"name":"PB","team_id":2}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/pools", `{"name":"pool-a","group_name":"standard","team_id":1}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/pools", `{"name":"pool-b","group_name":"standard","team_id":2}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/users",
		`{"phone":"13900002001","name":"开发A","role":"developer","password":"Dev@12345","team_id":1}`), 201)
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/users",
		`{"phone":"13900002002","name":"队长A","role":"team_admin","password":"Team@1234","team_id":1}`), 201)

	dev := newClient()
	_ = readBody(t, login(t, dev, ts.URL, "13900002001", "Dev@12345"))
	direct := postJSON(t, dev, ts.URL+"/console/v1/virtual-keys", `{"pool_id":2,"project_id":1}`)
	if direct.StatusCode != 403 {
		t.Fatalf("developer issue %d %s", direct.StatusCode, readBody(t, direct))
	}
	_ = readBody(t, direct)

	applied := postJSON(t, dev, ts.URL+"/console/v1/vk-requests", `{"pool_id":2,"project_id":1}`)
	araw := readBody(t, applied)
	if applied.StatusCode != 201 {
		t.Fatalf("apply %d %s", applied.StatusCode, araw)
	}
	if strings.Contains(araw, `"secret"`) {
		t.Fatalf("secret on apply: %s", araw)
	}
	if !strings.Contains(araw, `"pending"`) {
		t.Fatalf("want pending: %s", araw)
	}
	pend, err := http.NewRequest(http.MethodPost, ts.URL+"/v1/chat/completions", strings.NewReader(`{"model":"gpt-4"}`))
	if err != nil {
		t.Fatal(err)
	}
	pend.Header.Set("Authorization", "Bearer fab-not-issued")
	presp, err := http.DefaultClient.Do(pend)
	if err != nil {
		t.Fatal(err)
	}
	_ = readBody(t, presp)
	if presp.StatusCode == 200 {
		t.Fatal("pending/unknown vk must not reach upstream")
	}

	var view struct {
		ID     int64  `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal([]byte(araw), &view); err != nil {
		t.Fatal(err)
	}

	capB := newClient()
	mustOK(t, postJSON(t, admin, ts.URL+"/console/v1/users",
		`{"phone":"13900002003","name":"队长B","role":"team_admin","password":"Team@1234","team_id":2}`), 201)
	_ = readBody(t, login(t, capB, ts.URL, "13900002003", "Team@1234"))
	deny := postJSON(t, capB, ts.URL+"/console/v1/vk-requests/"+itoa(view.ID)+"/approve", `{}`)
	if deny.StatusCode != 403 {
		t.Fatalf("B approve A %d %s", deny.StatusCode, readBody(t, deny))
	}
	_ = readBody(t, deny)

	capA := newClient()
	_ = readBody(t, login(t, capA, ts.URL, "13900002002", "Team@1234"))
	ok := postJSON(t, capA, ts.URL+"/console/v1/vk-requests/"+itoa(view.ID)+"/approve", `{}`)
	okraw := readBody(t, ok)
	if ok.StatusCode != 200 {
		t.Fatalf("A approve %d %s", ok.StatusCode, okraw)
	}
	if !strings.Contains(okraw, `"fab-`) {
		t.Fatalf("missing secret: %s", okraw)
	}
}

func newClient() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar}
}

func postJSON(t *testing.T, c *http.Client, url, body string) *http.Response {
	t.Helper()
	resp, err := c.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func patchJSON(t *testing.T, c *http.Client, url, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPatch, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func getJSON(t *testing.T, c *http.Client, url string) string {
	t.Helper()
	resp, err := c.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	raw := readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("GET %s %d %s", url, resp.StatusCode, raw)
	}
	return raw
}

func mustOK(t *testing.T, resp *http.Response, want int) {
	t.Helper()
	raw := readBody(t, resp)
	if resp.StatusCode != want {
		t.Fatalf("status %d want %d %s", resp.StatusCode, want, raw)
	}
}
