package hub_test

import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"

	"kodax-fabric/internal/store"
)

func patchMe(t *testing.T, c *http.Client, base, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPatch, base+"/console/v1/me", strings.NewReader(body))
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

func freshClient(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Client{Jar: jar}
}

func TestRolesCanPatchOwnNameAndPassword(t *testing.T) {
	ts, _, admin := newConsole(t)
	_ = readBody(t, login(t, admin, ts.URL, "18612243416", "Hz@123456"))

	team, err := admin.Post(ts.URL+"/console/v1/teams", "application/json", strings.NewReader(`{"name":"A队"}`))
	if err != nil {
		t.Fatal(err)
	}
	if team.StatusCode != 201 {
		t.Fatalf("create team %d %s", team.StatusCode, readBody(t, team))
	}
	_ = team.Body.Close()

	created, err := admin.Post(ts.URL+"/console/v1/users", "application/json", strings.NewReader(
		`{"phone":"13900001001","name":"队长A","role":"team_admin","password":"Team@1234","team_id":1}`))
	if err != nil {
		t.Fatal(err)
	}
	if created.StatusCode != 201 {
		t.Fatalf("create captain %d %s", created.StatusCode, readBody(t, created))
	}
	_ = created.Body.Close()

	cases := []struct {
		phone, oldPass, newPass, newName string
	}{
		{"18612243416", "Hz@123456", "Hz@654321", "企管新名"},
		{"13900001001", "Team@1234", "Team@4321", "队长新名"},
		{"13800138000", "Dev@123456", "Dev@654321", "开发新名"},
	}
	for _, tc := range cases {
		c := freshClient(t)
		_ = readBody(t, login(t, c, ts.URL, tc.phone, tc.oldPass))

		got := patchMe(t, c, ts.URL, `{"name":"`+tc.newName+`","password":"`+tc.newPass+`"}`)
		raw := readBody(t, got)
		if got.StatusCode != 200 {
			t.Fatalf("%s patch %d %s", tc.phone, got.StatusCode, raw)
		}
		if strings.Contains(raw, "password_hash") || strings.Contains(raw, tc.newPass) {
			t.Fatalf("%s leaked secret: %s", tc.phone, raw)
		}
		var wrap struct {
			Operator store.Operator `json:"operator"`
		}
		if err := json.Unmarshal([]byte(raw), &wrap); err != nil {
			t.Fatal(err)
		}
		if wrap.Operator.Name != tc.newName {
			t.Fatalf("%s name %q", tc.phone, wrap.Operator.Name)
		}

		me, err := c.Get(ts.URL + "/console/v1/me")
		if err != nil {
			t.Fatal(err)
		}
		meRaw := readBody(t, me)
		if me.StatusCode != 200 || !strings.Contains(meRaw, tc.newName) {
			t.Fatalf("%s me %d %s", tc.phone, me.StatusCode, meRaw)
		}

		oldLogin := login(t, freshClient(t), ts.URL, tc.phone, tc.oldPass)
		if oldLogin.StatusCode != 401 {
			t.Fatalf("%s old password still works %d %s", tc.phone, oldLogin.StatusCode, readBody(t, oldLogin))
		}
		_ = oldLogin.Body.Close()

		newLogin := login(t, freshClient(t), ts.URL, tc.phone, tc.newPass)
		if newLogin.StatusCode != 200 {
			t.Fatalf("%s new password %d %s", tc.phone, newLogin.StatusCode, readBody(t, newLogin))
		}
		_ = newLogin.Body.Close()
	}
}

func TestPatchMeEmptyPasswordKeepsOld(t *testing.T) {
	ts, _, c := newConsole(t)
	_ = readBody(t, login(t, c, ts.URL, "13800138000", "Dev@123456"))

	got := patchMe(t, c, ts.URL, `{"name":"只改名","password":""}`)
	raw := readBody(t, got)
	if got.StatusCode != 200 {
		t.Fatalf("status %d %s", got.StatusCode, raw)
	}
	if !strings.Contains(raw, "只改名") {
		t.Fatalf("name not updated: %s", raw)
	}

	again := login(t, freshClient(t), ts.URL, "13800138000", "Dev@123456")
	if again.StatusCode != 200 {
		t.Fatalf("old password should still work %d %s", again.StatusCode, readBody(t, again))
	}
	_ = again.Body.Close()
}

func TestPatchMeIgnoresIdentityFields(t *testing.T) {
	ts, _, c := newConsole(t)
	_ = readBody(t, login(t, c, ts.URL, "13800138000", "Dev@123456"))

	got := patchMe(t, c, ts.URL, `{"name":"开发者","role":"org_admin","team_id":99,"status":"disabled"}`)
	raw := readBody(t, got)
	if got.StatusCode != 200 {
		t.Fatalf("status %d %s", got.StatusCode, raw)
	}
	var wrap struct {
		Operator store.Operator `json:"operator"`
	}
	if err := json.Unmarshal([]byte(raw), &wrap); err != nil {
		t.Fatal(err)
	}
	if wrap.Operator.Role != store.RoleDeveloper {
		t.Fatalf("role mutated: %s", wrap.Operator.Role)
	}
	if wrap.Operator.TeamID != 0 {
		t.Fatalf("team mutated: %d", wrap.Operator.TeamID)
	}
	if wrap.Operator.Phone != "13800138000" {
		t.Fatalf("phone mutated: %s", wrap.Operator.Phone)
	}
	if wrap.Operator.Status != store.StatusActive {
		t.Fatalf("status mutated: %s", wrap.Operator.Status)
	}
}

func TestPatchMeCanChangePhone(t *testing.T) {
	ts, _, c := newConsole(t)
	_ = readBody(t, login(t, c, ts.URL, "13800138000", "Dev@123456"))

	got := patchMe(t, c, ts.URL, `{"phone":"13900008888"}`)
	raw := readBody(t, got)
	if got.StatusCode != 200 {
		t.Fatalf("status %d %s", got.StatusCode, raw)
	}
	var wrap struct {
		Operator store.Operator `json:"operator"`
	}
	if err := json.Unmarshal([]byte(raw), &wrap); err != nil {
		t.Fatal(err)
	}
	if wrap.Operator.Phone != "13900008888" {
		t.Fatalf("phone %s", wrap.Operator.Phone)
	}

	oldLogin := login(t, freshClient(t), ts.URL, "13800138000", "Dev@123456")
	if oldLogin.StatusCode != 401 {
		t.Fatalf("old phone still works %d %s", oldLogin.StatusCode, readBody(t, oldLogin))
	}
	_ = oldLogin.Body.Close()

	newLogin := login(t, freshClient(t), ts.URL, "13900008888", "Dev@123456")
	if newLogin.StatusCode != 200 {
		t.Fatalf("new phone %d %s", newLogin.StatusCode, readBody(t, newLogin))
	}
	_ = newLogin.Body.Close()
}

func TestPatchMePhoneConflict(t *testing.T) {
	ts, _, c := newConsole(t)
	_ = readBody(t, login(t, c, ts.URL, "13800138000", "Dev@123456"))

	got := patchMe(t, c, ts.URL, `{"phone":"18612243416"}`)
	if got.StatusCode != 409 {
		t.Fatalf("status %d %s", got.StatusCode, readBody(t, got))
	}
}

func TestPatchMeEmptyPhoneRejected(t *testing.T) {
	ts, _, c := newConsole(t)
	_ = readBody(t, login(t, c, ts.URL, "13800138000", "Dev@123456"))

	got := patchMe(t, c, ts.URL, `{"phone":""}`)
	if got.StatusCode != 400 {
		t.Fatalf("status %d %s", got.StatusCode, readBody(t, got))
	}
}

func TestPatchMeShortPasswordRejected(t *testing.T) {
	ts, _, c := newConsole(t)
	_ = readBody(t, login(t, c, ts.URL, "18612243416", "Hz@123456"))

	got := patchMe(t, c, ts.URL, `{"password":"short"}`)
	raw := readBody(t, got)
	if got.StatusCode != 400 {
		t.Fatalf("status %d %s", got.StatusCode, raw)
	}
}

func TestPatchMeRequiresLogin(t *testing.T) {
	ts, _, _ := newConsole(t)
	c := &http.Client{}
	got := patchMe(t, c, ts.URL, `{"name":"x"}`)
	if got.StatusCode != 401 {
		t.Fatalf("status %d %s", got.StatusCode, readBody(t, got))
	}
	_ = got.Body.Close()
}

func TestDeveloperCannotPatchOtherUser(t *testing.T) {
	ts, _, admin := newConsole(t)
	_ = readBody(t, login(t, admin, ts.URL, "18612243416", "Hz@123456"))
	created, err := admin.Post(ts.URL+"/console/v1/users", "application/json", strings.NewReader(
		`{"phone":"13900001112","name":"别人","role":"developer","password":"Passw0rd!"}`))
	if err != nil {
		t.Fatal(err)
	}
	raw := readBody(t, created)
	if created.StatusCode != 201 {
		t.Fatalf("create %d %s", created.StatusCode, raw)
	}
	var wrap struct {
		User store.Operator `json:"user"`
	}
	if err := json.Unmarshal([]byte(raw), &wrap); err != nil {
		t.Fatal(err)
	}

	dev := freshClient(t)
	_ = readBody(t, login(t, dev, ts.URL, "13800138000", "Dev@123456"))
	req, _ := http.NewRequest(http.MethodPatch, ts.URL+"/console/v1/users/"+itoa(wrap.User.ID), strings.NewReader(`{"name":"劫持"}`))
	req.Header.Set("Content-Type", "application/json")
	got, err := dev.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if got.StatusCode != 403 {
		t.Fatalf("status %d %s", got.StatusCode, readBody(t, got))
	}
	_ = got.Body.Close()
}
