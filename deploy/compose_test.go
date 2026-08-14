package deploy_test

import (
	"os"
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
	if !strings.Contains(text, "start --no-deps gateway") {
		t.Fatal("restore must start gateway with --no-deps so bootstrap does not rerun")
	}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "start gateway") && !strings.Contains(line, "--no-deps") {
			t.Fatalf("bare start gateway would rerun bootstrap: %s", line)
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
