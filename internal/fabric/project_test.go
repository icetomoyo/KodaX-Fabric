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

func TestAdminCreateProjectCannotRenameOrDelete(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)

	resp, err := admin.Post(srv.URL+"/admin/api/projects", "application/json", bytes.NewReader([]byte(`{"name":"billing"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("create project %d: %s", resp.StatusCode, b)
	}

	listed := listProjects(t, admin, srv.URL)
	if !containsProject(listed, "billing") || !containsProject(listed, fabric.SeedProject) {
		t.Fatalf("projects %+v", listed)
	}

	del, err := http.NewRequest(http.MethodDelete, srv.URL+"/admin/api/projects/billing", nil)
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

	patch, err := http.NewRequest(http.MethodPatch, srv.URL+"/admin/api/projects/billing", bytes.NewReader([]byte(`{"name":"other"}`)))
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

	if !containsProject(listProjects(t, admin, srv.URL), "billing") {
		t.Fatal("project vanished after refused delete/rename")
	}
}

func TestRequestProjectComesFromVirtualKeyNotHeader(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	mustCreateProject(t, admin, srv.URL, "billing")
	vkDemo := createVK(t, admin, srv.URL, fabric.SeedProject)
	vkBill := createVK(t, admin, srv.URL, "billing")

	status, _ := postChatWithContext(t, srv, vkDemo.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`, `{"project_id":"demo","task_type":"eval"}`)
	if status != http.StatusOK {
		t.Fatalf("matching project_id %d", status)
	}
	status, _ = postChatWithContext(t, srv, vkDemo.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`, "")
	if status != http.StatusOK {
		t.Fatalf("no header %d", status)
	}

	calls := srv.ProviderCalls()
	status, _ = postChatWithContext(t, srv, vkDemo.Plaintext, `{"model":"gpt-4o-mini","messages":[]}`, `{"project_id":"billing"}`)
	if status != http.StatusBadRequest {
		t.Fatalf("mismatch %d", status)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("mismatch called provider")
	}

	calls = srv.ProviderCalls()
	status, _ = postChatWithContext(t, srv, vkDemo.Plaintext, `{"model":"gpt-4o-mini","messages":[]}`, `{not-json`)
	if status != http.StatusBadRequest {
		t.Fatalf("malformed %d", status)
	}
	if srv.ProviderCalls() != calls {
		t.Fatal("malformed header called provider")
	}

	status, _ = postChatWithContext(t, srv, vkBill.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`, "")
	if status != http.StatusOK {
		t.Fatalf("billing vk %d", status)
	}

	rows := listRequestDetails(t, admin, srv.URL, fabric.SeedProject)
	if len(rows) < 2 {
		t.Fatalf("demo requests %+v", rows)
	}
	for _, row := range rows {
		if row.Project != fabric.SeedProject {
			t.Fatalf("header overrode project: %+v", row)
		}
	}
	bill := listRequestDetails(t, admin, srv.URL, "billing")
	if len(bill) != 1 || bill[0].Project != "billing" {
		t.Fatalf("billing request %+v", bill)
	}
}

func TestRunIDAndTaskTypeRecordedWithoutInference(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	vk := createVK(t, admin, srv.URL, fabric.SeedProject)

	status, _ := postChatWithContext(t, srv, vk.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`, `{"run_id":"run-9","task_type":"codegen"}`)
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	status, _ = postChatWithContext(t, srv, vk.Plaintext, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`, "")
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}

	rows := listRequestDetails(t, admin, srv.URL, fabric.SeedProject)
	if len(rows) != 2 {
		t.Fatalf("rows %+v", rows)
	}
	var withRun, without RunView
	for _, r := range rows {
		if r.RunID == "run-9" {
			withRun = r
		}
		if r.RunID == "" {
			without = r
		}
	}
	if withRun.TaskType != "codegen" {
		t.Fatalf("task_type %+v", withRun)
	}
	if without.RunID != "" || without.TaskType != "" {
		t.Fatalf("inferred run? %+v", without)
	}
}

func TestCreateVirtualKeyRequiresExistingProject(t *testing.T) {
	srv := newTestServer(t)
	admin := loginAdmin(t, srv)
	body, _ := json.Marshal(map[string]string{"project": "no-such"})
	resp, err := admin.Post(srv.URL+"/admin/api/virtual-keys", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func postChatWithContext(t *testing.T, srv *httptestServer, vk, raw, fabricCtx string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader([]byte(raw)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+vk)
	req.Header.Set("Content-Type", "application/json")
	if fabricCtx != "" {
		req.Header.Set("x-fabric-context", fabricCtx)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, b
}

func mustCreateProject(t *testing.T, admin *http.Client, base, name string) {
	t.Helper()
	resp, err := admin.Post(base+"/admin/api/projects", "application/json", bytes.NewReader([]byte(`{"name":"`+name+`"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("create project %d: %s", resp.StatusCode, b)
	}
}

func listProjects(t *testing.T, admin *http.Client, base string) []string {
	t.Helper()
	resp, err := admin.Get(base + "/admin/api/projects")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Projects []struct {
			Name string `json:"name"`
		} `json:"projects"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(payload.Projects))
	for _, p := range payload.Projects {
		names = append(names, p.Name)
	}
	return names
}

func containsProject(names []string, want string) bool {
	for _, n := range names {
		if n == want {
			return true
		}
	}
	return false
}

type RunView struct {
	Project  string `json:"project"`
	RunID    string `json:"run_id"`
	TaskType string `json:"task_type"`
}

func listRequestDetails(t *testing.T, admin *http.Client, base, project string) []RunView {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	var last []RunView
	for time.Now().Before(deadline) {
		resp, err := admin.Get(base + "/admin/api/requests?project=" + project)
		if err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Requests []RunView `json:"requests"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			resp.Body.Close()
			t.Fatal(err)
		}
		resp.Body.Close()
		last = payload.Requests
		if len(last) > 0 {
			return last
		}
		time.Sleep(5 * time.Millisecond)
	}
	return last
}
