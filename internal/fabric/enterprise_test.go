package fabric_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func TestSuperAdminCreateEnterpriseCannotRenameOrDelete(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)

	resp, err := admin.Post(srv.URL+"/admin/api/enterprises", "application/json", bytes.NewReader([]byte(`{"name":"acme"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("create enterprise %d: %s", resp.StatusCode, b)
	}

	names := listEnterprises(t, admin, srv.URL)
	if !containsProject(names, "acme") || !containsProject(names, fabric.SeedEnterprise) {
		t.Fatalf("enterprises %+v", names)
	}

	del, err := http.NewRequest(http.MethodDelete, srv.URL+"/admin/api/enterprises/acme", nil)
	if err != nil {
		t.Fatal(err)
	}
	dresp, err := admin.Do(del)
	if err != nil {
		t.Fatal(err)
	}
	_ = dresp.Body.Close()
	if dresp.StatusCode != http.StatusNotFound && dresp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("delete should be refused, got %d", dresp.StatusCode)
	}

	patch, err := http.NewRequest(http.MethodPatch, srv.URL+"/admin/api/enterprises/acme", bytes.NewReader([]byte(`{"name":"other"}`)))
	if err != nil {
		t.Fatal(err)
	}
	presp, err := admin.Do(patch)
	if err != nil {
		t.Fatal(err)
	}
	_ = presp.Body.Close()
	if presp.StatusCode != http.StatusNotFound && presp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("rename should be refused, got %d", presp.StatusCode)
	}
}

func TestDisableEnterpriseRejectsItsVirtualKeys(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)

	status, _ := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusOK {
		t.Fatalf("before disable %d", status)
	}

	resp, err := admin.Post(srv.URL+"/admin/api/enterprises/"+fabric.SeedEnterprise+"/disable", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("disable %d: %s", resp.StatusCode, b)
	}

	calls := srv.ProviderCalls()
	status, body := postChat(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if status != http.StatusForbidden {
		t.Fatalf("after disable %d: %s", status, body)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("disabled enterprise called provider")
	}
}

func TestTeamIDMustMatchVirtualKeyTeam(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	mustCreateProject(t, admin, srv.URL, "billing")
	vkDemo := createVK(t, admin, srv.URL, fabric.SeedTeam)

	status, _ := postChatWithContext(t, srv, vkDemo.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`, `{"team_id":"demo","task_type":"eval"}`)
	if status != http.StatusOK {
		t.Fatalf("matching team_id %d", status)
	}

	calls := srv.ProviderCalls()
	status, _ = postChatWithContext(t, srv, vkDemo.Plaintext, `{"model":"gpt-4o-mini","messages":[]}`, `{"team_id":"billing"}`)
	if status != http.StatusBadRequest {
		t.Fatalf("team mismatch %d", status)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("team mismatch called provider")
	}
}

func TestProjectIDInFabricContextIsRejected(t *testing.T) {
	srv := newTestServer(t)
	calls := srv.ProviderCalls()
	status, _ := postChatWithContext(t, srv, fabric.SeedVirtualKey, `{"model":"gpt-4o-mini","messages":[]}`, `{"project_id":"demo"}`)
	if status != http.StatusBadRequest {
		t.Fatalf("project_id %d", status)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("project_id called provider")
	}
}

func TestMeRoleIsSuperAdmin(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	resp, err := admin.Get(srv.URL + "/admin/api/me")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var me struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	if me.Role != "super_admin" {
		t.Fatalf("role %q", me.Role)
	}
}

func listEnterprises(t *testing.T, admin *http.Client, base string) []string {
	t.Helper()
	resp, err := admin.Get(base + "/admin/api/enterprises")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Enterprises []struct {
			Name string `json:"name"`
		} `json:"enterprises"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(payload.Enterprises))
	for _, e := range payload.Enterprises {
		names = append(names, e.Name)
	}
	return names
}
