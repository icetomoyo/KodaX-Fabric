package deploy_test

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestPostgresUsesNamedVolume(t *testing.T) {
	raw, err := os.ReadFile("compose.yaml")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if !strings.Contains(text, "pgdata:/var/lib/postgresql/data") {
		t.Fatal("postgres must mount named volume pgdata")
	}
	if !strings.Contains(text, "\n  pgdata:") && !strings.Contains(text, "\npgdata:") {
		t.Fatal("pgdata must be declared under volumes")
	}
}

func TestRestoreStartsGatewayWithoutDeps(t *testing.T) {
	raw, err := os.ReadFile("restore.sh")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if strings.Contains(text, "start --no-deps") {
		t.Fatal("compose start does not accept --no-deps")
	}
	if !strings.Contains(text, "up -d --no-deps gateway") {
		t.Fatal("restore must up -d --no-deps gateway so bootstrap does not rerun")
	}
}

func TestComposeUpNoDepsIsValid(t *testing.T) {
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("docker not in PATH")
	}
	startHelp, err := exec.Command("docker", "compose", "start", "--help").CombinedOutput()
	if err != nil {
		t.Skipf("docker compose start --help: %v", err)
	}
	if strings.Contains(string(startHelp), "--no-deps") {
		t.Fatal("compose start unexpectedly lists --no-deps; restore assumed it did not")
	}
	cmd := exec.Command("docker", "compose", "-p", "tokenhub", "-f", "compose.yaml", "up", "-d", "--no-deps", "--dry-run", "gateway")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("up -d --no-deps --dry-run gateway: %v\n%s", err, out)
	}
}

func TestReadmeDocumentsAliasAndProviderRPM(t *testing.T) {
	raw, err := os.ReadFile("README.md")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, want := range []string{"模型别名", "Provider RPM", "rpm_limit", "model-aliases"} {
		if !strings.Contains(text, want) {
			t.Errorf("deploy README missing %q", want)
		}
	}
}

func TestDockerfileBuildsFrontend(t *testing.T) {
	raw, err := os.ReadFile("Dockerfile")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if !strings.Contains(text, "npm run build") {
		t.Fatal("image build must compile the console before go embed")
	}
}
