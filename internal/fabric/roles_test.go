package fabric_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"testing"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestSuperAdminCreatesEnterpriseAdminWhoCanLogIn(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	mustCreateEnterprise(t, admin, srv.URL, "acme")

	created := mustCreateUser(t, admin, srv.URL, map[string]string{
		"username":   "acme-boss",
		"password":   "secret-pass",
		"role":       "enterprise_admin",
		"enterprise": "acme",
	})
	if created.Username != "acme-boss" || created.Role != "enterprise_admin" || created.Enterprise != "acme" {
		t.Fatalf("created %+v", created)
	}
	if created.Password != "" {
		t.Fatal("password leaked")
	}

	client := loginUser(t, srv, "acme-boss", "secret-pass")
	me := getMe(t, client, srv.URL)
	if me.Role != "enterprise_admin" || me.Enterprise != "acme" || me.Username != "acme-boss" {
		t.Fatalf("me %+v", me)
	}
}

func TestEnterpriseAdminCannotSeeOtherEnterprises(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	mustCreateEnterprise(t, admin, srv.URL, "acme")
	mustCreateEnterprise(t, admin, srv.URL, "other")
	mustCreateUser(t, admin, srv.URL, map[string]string{
		"username":   "acme-boss",
		"password":   "secret-pass",
		"role":       "enterprise_admin",
		"enterprise": "acme",
	})

	client := loginUser(t, srv, "acme-boss", "secret-pass")
	names := listEnterprises(t, client, srv.URL)
	if !containsProject(names, "acme") {
		t.Fatalf("missing own enterprise %+v", names)
	}
	if containsProject(names, "other") || containsProject(names, fabric.SeedEnterprise) {
		t.Fatalf("saw other enterprises %+v", names)
	}
}

func TestEnterpriseAdminCreatesTeamAndStaff(t *testing.T) {
	srv := newTestServer(t)
	boss := newEnterpriseAdmin(t, srv, "acme", "acme-boss")

	mustCreateProject(t, boss, srv.URL, "billing")
	listed := listProjects(t, boss, srv.URL)
	if !containsProject(listed, "billing") {
		t.Fatalf("own team missing %+v", listed)
	}
	if containsProject(listed, fabric.SeedTeam) {
		t.Fatalf("saw seed team %+v", listed)
	}

	del, err := http.NewRequest(http.MethodDelete, srv.URL+"/admin/api/projects/billing", nil)
	if err != nil {
		t.Fatal(err)
	}
	dresp, err := boss.Do(del)
	if err != nil {
		t.Fatal(err)
	}
	_ = dresp.Body.Close()
	if dresp.StatusCode != http.StatusNotFound && dresp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("delete team %d", dresp.StatusCode)
	}

	lead := mustCreateUser(t, boss, srv.URL, map[string]string{
		"username": "acme-lead",
		"password": "lead-pass",
		"role":     "team_admin",
	})
	if lead.Role != "team_admin" || lead.Enterprise != "acme" {
		t.Fatalf("lead %+v", lead)
	}
	dev := mustCreateUser(t, boss, srv.URL, map[string]string{
		"username": "acme-dev",
		"password": "dev-pass",
		"role":     "developer",
	})
	if dev.Role != "developer" || dev.Enterprise != "acme" {
		t.Fatalf("dev %+v", dev)
	}

	mustAddMember(t, boss, srv.URL, "billing", "acme-lead")
	mustAddMember(t, boss, srv.URL, "billing", "acme-dev")

	leadClient := loginUser(t, srv, "acme-lead", "lead-pass")
	me := getMe(t, leadClient, srv.URL)
	if !containsProject(me.Teams, "billing") {
		t.Fatalf("lead teams %+v", me.Teams)
	}
	if !containsProject(listProjects(t, leadClient, srv.URL), "billing") {
		t.Fatal("lead cannot see team")
	}
}

func TestTeamAdminAddsAndRemovesDevelopersButCannotCreateTeamAdmin(t *testing.T) {
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
	lead := loginUser(t, srv, "acme-lead", "lead-pass")

	raw, _ := json.Marshal(map[string]string{
		"username": "other-lead", "password": "x", "role": "team_admin",
	})
	resp, err := lead.Post(srv.URL+"/admin/api/users", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("create team_admin %d", resp.StatusCode)
	}

	mustAddMember(t, lead, srv.URL, "billing", "acme-dev")
	dev := loginUser(t, srv, "acme-dev", "dev-pass")
	if !containsProject(listProjects(t, dev, srv.URL), "billing") {
		t.Fatal("dev cannot see team after add")
	}

	del, err := http.NewRequest(http.MethodDelete, srv.URL+"/admin/api/teams/billing/members/acme-dev", nil)
	if err != nil {
		t.Fatal(err)
	}
	dresp, err := lead.Do(del)
	if err != nil {
		t.Fatal(err)
	}
	_ = dresp.Body.Close()
	if dresp.StatusCode != http.StatusOK {
		t.Fatalf("remove %d", dresp.StatusCode)
	}
	if containsProject(listProjects(t, dev, srv.URL), "billing") {
		t.Fatal("dev still sees team after remove")
	}
}

func TestRemovedMemberCannotSeeTeamButIssuedVirtualKeyStillWorks(t *testing.T) {
	srv := newTestServer(t)
	boss := newEnterpriseAdmin(t, srv, "acme", "acme-boss")
	mustCreateProject(t, boss, srv.URL, "billing")
	mustCreateUser(t, boss, srv.URL, map[string]string{
		"username": "acme-dev", "password": "dev-pass", "role": "developer",
	})
	mustAddMember(t, boss, srv.URL, "billing", "acme-dev")
	vk := createVK(t, boss, srv.URL, "billing")

	del, err := http.NewRequest(http.MethodDelete, srv.URL+"/admin/api/teams/billing/members/acme-dev", nil)
	if err != nil {
		t.Fatal(err)
	}
	dresp, err := boss.Do(del)
	if err != nil {
		t.Fatal(err)
	}
	_ = dresp.Body.Close()
	if dresp.StatusCode != http.StatusOK {
		t.Fatalf("remove %d", dresp.StatusCode)
	}

	dev := loginUser(t, srv, "acme-dev", "dev-pass")
	if containsProject(listProjects(t, dev, srv.URL), "billing") {
		t.Fatal("removed member still sees team")
	}

	status, _ := postChat(t, srv, vk.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("vk after remove %d", status)
	}

	reqResp, err := dev.Get(srv.URL + "/admin/api/requests?project=billing")
	if err != nil {
		t.Fatal(err)
	}
	_ = reqResp.Body.Close()
	if reqResp.StatusCode != http.StatusForbidden {
		t.Fatalf("requests after remove %d", reqResp.StatusCode)
	}
	usageResp, err := dev.Get(srv.URL + "/admin/api/usage?project=billing")
	if err != nil {
		t.Fatal(err)
	}
	_ = usageResp.Body.Close()
	if usageResp.StatusCode != http.StatusForbidden {
		t.Fatalf("usage after remove %d", usageResp.StatusCode)
	}
	vkResp, err := dev.Get(srv.URL + "/admin/api/virtual-keys")
	if err != nil {
		t.Fatal(err)
	}
	defer vkResp.Body.Close()
	var keys struct {
		Keys []struct {
			Project string `json:"project"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(vkResp.Body).Decode(&keys); err != nil {
		t.Fatal(err)
	}
	for _, k := range keys.Keys {
		if k.Project == "billing" {
			t.Fatal("removed member listed team VK")
		}
	}
}

func TestDeveloperCanJoinMultipleTeams(t *testing.T) {
	srv := newTestServer(t)
	boss := newEnterpriseAdmin(t, srv, "acme", "acme-boss")
	mustCreateProject(t, boss, srv.URL, "billing")
	mustCreateProject(t, boss, srv.URL, "research")
	mustCreateUser(t, boss, srv.URL, map[string]string{
		"username": "acme-dev", "password": "dev-pass", "role": "developer",
	})
	mustAddMember(t, boss, srv.URL, "billing", "acme-dev")
	mustAddMember(t, boss, srv.URL, "research", "acme-dev")

	dev := loginUser(t, srv, "acme-dev", "dev-pass")
	me := getMe(t, dev, srv.URL)
	if !containsProject(me.Teams, "billing") || !containsProject(me.Teams, "research") {
		t.Fatalf("teams %+v", me.Teams)
	}
	listed := listProjects(t, dev, srv.URL)
	if !containsProject(listed, "billing") || !containsProject(listed, "research") {
		t.Fatalf("listed %+v", listed)
	}
}

func TestRoleForbiddenOnPlatformAndEnterpriseAPIs(t *testing.T) {
	srv := newTestServer(t)
	boss := newEnterpriseAdmin(t, srv, "acme", "acme-boss")
	mustCreateProject(t, boss, srv.URL, "billing")
	mustCreateUser(t, boss, srv.URL, map[string]string{
		"username": "acme-dev", "password": "dev-pass", "role": "developer",
	})
	mustAddMember(t, boss, srv.URL, "billing", "acme-dev")
	dev := loginUser(t, srv, "acme-dev", "dev-pass")

	assertForbidden(t, dev, http.MethodPost, srv.URL+"/admin/api/providers", `{"name":"x","family":"openai","base_url":"http://x","api_key":"k"}`)
	assertForbidden(t, dev, http.MethodPost, srv.URL+"/admin/api/enterprises", `{"name":"nope"}`)
	assertForbidden(t, dev, http.MethodPost, srv.URL+"/admin/api/users", `{"username":"z","password":"p","role":"developer"}`)
	assertForbidden(t, dev, http.MethodGet, srv.URL+"/admin/api/enterprises", "")

	assertForbidden(t, boss, http.MethodPost, srv.URL+"/admin/api/providers", `{"name":"x","family":"openai","base_url":"http://x","api_key":"k"}`)
	assertForbidden(t, boss, http.MethodGet, srv.URL+"/admin/api/providers", "")
	assertForbidden(t, boss, http.MethodGet, srv.URL+"/admin/api/prices", "")
	assertForbidden(t, boss, http.MethodPost, srv.URL+"/admin/api/models", `{"name":"m","family":"openai","provider":"x"}`)
}

func assertForbidden(t *testing.T, client *http.Client, method, url, body string) {
	t.Helper()
	var resp *http.Response
	var err error
	if method == http.MethodGet {
		resp, err = client.Get(url)
	} else {
		resp, err = client.Post(url, "application/json", bytes.NewReader([]byte(body)))
	}
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("%s %s %d: %s", method, url, resp.StatusCode, b)
	}
}

func newEnterpriseAdmin(t *testing.T, srv *httptestServer, enterprise, username string) *http.Client {
	t.Helper()
	admin := loginAdmin(t, srv)
	mustCreateEnterprise(t, admin, srv.URL, enterprise)
	mustCreateUser(t, admin, srv.URL, map[string]string{
		"username":   username,
		"password":   username + "-pass",
		"role":       "enterprise_admin",
		"enterprise": enterprise,
	})
	return loginUser(t, srv, username, username+"-pass")
}

func mustAddMember(t *testing.T, client *http.Client, base, team, username string) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username})
	resp, err := client.Post(base+"/admin/api/teams/"+team+"/members", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("add member %s %s %d: %s", team, username, resp.StatusCode, b)
	}
}

type userView struct {
	Username   string   `json:"username"`
	Role       string   `json:"role"`
	Enterprise string   `json:"enterprise"`
	Password   string   `json:"password"`
	Teams      []string `json:"teams"`
}

func mustCreateEnterprise(t *testing.T, client *http.Client, base, name string) {
	t.Helper()
	resp, err := client.Post(base+"/admin/api/enterprises", "application/json", bytes.NewReader([]byte(`{"name":"`+name+`"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("create enterprise %s %d: %s", name, resp.StatusCode, b)
	}
}

func mustCreateUser(t *testing.T, client *http.Client, base string, body map[string]string) userView {
	t.Helper()
	raw, _ := json.Marshal(body)
	resp, err := client.Post(base+"/admin/api/users", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create user %d: %s", resp.StatusCode, b)
	}
	var out userView
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func loginUser(t *testing.T, srv *httptestServer, username, password string) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}
	payload, _ := json.Marshal(map[string]string{"username": username, "password": password})
	resp, err := client.Post(srv.URL+"/admin/api/login", "application/json", bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("login %s %d: %s", username, resp.StatusCode, b)
	}
	return client
}

func getMe(t *testing.T, client *http.Client, base string) userView {
	t.Helper()
	resp, err := client.Get(base + "/admin/api/me")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("me %d: %s", resp.StatusCode, b)
	}
	var me userView
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	return me
}
