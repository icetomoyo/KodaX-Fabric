package store

import (
	"testing"
	"time"
)

func TestNormalizeRotationSchedule(t *testing.T) {
	act := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	ret := act.Add(time.Hour)
	gotA, gotR, err := NormalizeRotationSchedule(&act, &ret)
	if err != nil || !gotA.Equal(act) || !gotR.Equal(ret) {
		t.Fatalf("%v %v %v", gotA, gotR, err)
	}
	_, gotR, err = NormalizeRotationSchedule(&act, nil)
	if err != nil || !gotR.Equal(act.Add(DefaultRotationGrace)) {
		t.Fatalf("default grace %v %v", gotR, err)
	}
	early := act.Add(-time.Minute)
	if _, _, err = NormalizeRotationSchedule(&act, &early); err == nil {
		t.Fatal("retire before activate")
	}
	if _, _, err = NormalizeRotationSchedule(nil, &ret); err == nil {
		t.Fatal("retire without activate")
	}
}

func TestReplacementPhase(t *testing.T) {
	now := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	act := now.Add(time.Hour)
	ret := now.Add(2 * time.Hour)
	p, o, d := ReplacementPhase(true, &act, &ret, now)
	if !p || o || d {
		t.Fatal("pending")
	}
	p, o, d = ReplacementPhase(true, &now, &ret, now.Add(time.Minute))
	if p || !o || d {
		t.Fatal("overlap")
	}
	p, o, d = ReplacementPhase(true, &now, &now, now.Add(time.Minute))
	if p || o || !d {
		t.Fatal("done")
	}
}
