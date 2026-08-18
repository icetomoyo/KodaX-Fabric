package fabric_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestAdminCreateVirtualKeyPlaintextShownOnce(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)

	created := createVK(t, admin, srv.URL, fabric.SeedProject)
	if created.Plaintext == "" || !strings.HasPrefix(created.Plaintext, "sk-fab-") {
		t.Fatalf("missing plaintext: %+v", created)
	}
	if created.Hash == "" || created.Hash != fabric.HashVirtualKey(created.Plaintext) {
		t.Fatalf("hash %+v", created)
	}
	if created.Project != fabric.SeedProject || created.Disabled {
		t.Fatalf("record %+v", created)
	}

	got := getVK(t, admin, srv.URL, created.Hash)
	if got.Plaintext != "" {
		t.Fatalf("plaintext leaked on reread: %+v", got)
	}
	if got.Hash != created.Hash {
		t.Fatalf("got %+v", got)
	}

	listed := listVKs(t, admin, srv.URL)
	for _, k := range listed {
		if k.Plaintext != "" {
			t.Fatalf("plaintext in list: %+v", k)
		}
	}
}

func TestCreatedVirtualKeyCanCallGateway(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	created := createVK(t, admin, srv.URL, fabric.SeedProject)

	status, _ := postChat(t, srv, created.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("chat status %d", status)
	}
	listed := listRequests(t, admin, srv.URL)
	if len(listed) != 1 {
		t.Fatalf("requests %+v", listed)
	}
}

func TestDisableVirtualKeyRejectsNewCalls(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	created := createVK(t, admin, srv.URL, fabric.SeedProject)

	status := disableVK(t, admin, srv.URL, created.Hash)
	if status != http.StatusOK {
		t.Fatalf("disable %d", status)
	}
	calls := srv.ProviderCalls()
	chatStatus, _ := postChat(t, srv, created.Plaintext, `{"model":"gpt-4o-mini","messages":[]}`)
	if chatStatus != http.StatusUnauthorized {
		t.Fatalf("disabled key status %d", chatStatus)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("disabled key called provider")
	}
}

func TestInvalidVirtualKeyRejected(t *testing.T) {
	srv := newTestServer(t)
	status, _ := postChat(t, srv, "sk-fab-nope", `{"model":"gpt-4o-mini","messages":[]}`)
	if status != http.StatusUnauthorized {
		t.Fatalf("status %d", status)
	}
	if srv.ProviderCalls() != 0 {
		t.Fatal("invalid key called provider")
	}
}

func TestNoVirtualKeyRotate(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	created := createVK(t, admin, srv.URL, fabric.SeedProject)
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/admin/api/virtual-keys/"+created.Hash+"/rotate", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := admin.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("rotate should not exist, got %d", resp.StatusCode)
	}
}

func TestAdminMeAndLogout(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	resp, err := admin.Get(srv.URL + "/admin/api/me")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("me %d", resp.StatusCode)
	}
	logout, err := admin.Post(srv.URL+"/admin/api/logout", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = logout.Body.Close()
	again, err := admin.Get(srv.URL + "/admin/api/me")
	if err != nil {
		t.Fatal(err)
	}
	defer again.Body.Close()
	if again.StatusCode != http.StatusUnauthorized {
		t.Fatalf("after logout %d", again.StatusCode)
	}
}

func TestCreateVirtualKeyRequiresAdmin(t *testing.T) {
	srv := newTestServer(t)
	resp, err := srv.Client().Post(srv.URL+"/admin/api/virtual-keys", "application/json", bytes.NewReader([]byte(`{"project":"demo"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

type vkView struct {
	Hash      string `json:"hash"`
	Project   string `json:"project"`
	Disabled  bool   `json:"disabled"`
	Plaintext string `json:"plaintext"`
}

func createVK(t *testing.T, admin *http.Client, base, project string) vkView {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"project": project})
	resp, err := admin.Post(base+"/admin/api/virtual-keys", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("create %d: %s", resp.StatusCode, raw)
	}
	var out vkView
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func getVK(t *testing.T, admin *http.Client, base, hash string) vkView {
	t.Helper()
	resp, err := admin.Get(base + "/admin/api/virtual-keys/" + hash)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("get %d: %s", resp.StatusCode, b)
	}
	var out vkView
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func listVKs(t *testing.T, admin *http.Client, base string) []vkView {
	t.Helper()
	resp, err := admin.Get(base + "/admin/api/virtual-keys")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Keys []vkView `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	return payload.Keys
}

func disableVK(t *testing.T, admin *http.Client, base, hash string) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, base+"/admin/api/virtual-keys/"+hash+"/disable", nil)
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
