package hub

import (
	"testing"
	"time"
)

func TestParseCacheTTL(t *testing.T) {
	d, err := ParseCacheTTL("")
	if err != nil || d != time.Hour {
		t.Fatalf("default %v %v", d, err)
	}
	d, err = ParseCacheTTL("30m")
	if err != nil || d != 30*time.Minute {
		t.Fatalf("30m %v %v", d, err)
	}
	if _, err = ParseCacheTTL("nope"); err == nil {
		t.Fatal("invalid")
	}
	if _, err = ParseCacheTTL("0"); err == nil {
		t.Fatal("zero")
	}
	if _, err = ParseCacheTTL("-1h"); err == nil {
		t.Fatal("neg")
	}
}
