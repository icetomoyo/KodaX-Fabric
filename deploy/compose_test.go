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
