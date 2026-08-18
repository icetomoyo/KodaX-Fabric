package fabric

import (
	"sync"
	"time"
)

type healthState struct {
	results       []bool
	openedAt      time.Time
	open          bool
	probeInFlight bool
}

type HealthBook struct {
	mu      sync.Mutex
	now     func() time.Time
	window  int
	min     float64
	openFor time.Duration
	states  map[string]*healthState
}

func newHealthBook(now func() time.Time, window int, min float64, openFor time.Duration) *HealthBook {
	if window <= 0 {
		window = 100
	}
	if min <= 0 {
		min = 0.8
	}
	if openFor <= 0 {
		openFor = 30 * time.Second
	}
	return &HealthBook{now: now, window: window, min: min, openFor: openFor, states: map[string]*healthState{}}
}

func (h *HealthBook) allow(id string) (ok bool, release func()) {
	if id == "" {
		return true, func() {}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	st := h.states[id]
	if st == nil || !st.open {
		return true, func() {}
	}
	if h.now().Sub(st.openedAt) < h.openFor {
		return false, func() {}
	}
	if st.probeInFlight {
		return false, func() {}
	}
	st.probeInFlight = true
	return true, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if cur := h.states[id]; cur != nil {
			cur.probeInFlight = false
		}
	}
}

func (h *HealthBook) record(id string, success bool) {
	if id == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	st := h.states[id]
	if st == nil {
		st = &healthState{}
		h.states[id] = st
	}
	st.results = append(st.results, success)
	if len(st.results) > h.window {
		st.results = st.results[len(st.results)-h.window:]
	}
	if st.open && h.now().Sub(st.openedAt) >= h.openFor {
		if success {
			st.open = false
			st.results = nil
			return
		}
		st.openedAt = h.now()
		return
	}
	if !st.open && len(st.results) >= h.window {
		var ok int
		for _, s := range st.results {
			if s {
				ok++
			}
		}
		if float64(ok)/float64(len(st.results)) < h.min {
			st.open = true
			st.openedAt = h.now()
		}
	}
}

type RateBook struct {
	mu   sync.Mutex
	now  func() time.Time
	hits map[string][]time.Time
}

func newRateBook(now func() time.Time) *RateBook {
	return &RateBook{now: now, hits: map[string][]time.Time{}}
}

func (r *RateBook) prune(key string, now time.Time) []time.Time {
	cut := now.Add(-time.Minute)
	times := r.hits[key]
	kept := times[:0]
	for _, t := range times {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	r.hits[key] = kept
	return kept
}

func (r *RateBook) fits(key string, limit int) bool {
	if limit <= 0 {
		return true
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.prune(key, r.now())) < limit
}

func (r *RateBook) allow(key string, limit int) bool {
	if limit <= 0 {
		return true
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	kept := r.prune(key, now)
	if len(kept) >= limit {
		return false
	}
	r.hits[key] = append(kept, now)
	return true
}

func (h *HealthBook) blocked(id string) bool {
	if id == "" {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	st := h.states[id]
	if st == nil || !st.open {
		return false
	}
	return h.now().Sub(st.openedAt) < h.openFor
}

type SpendBook struct {
	mu   sync.Mutex
	team map[string]float64
	ent  map[string]float64
}

func newSpendBook() *SpendBook {
	return &SpendBook{team: map[string]float64{}, ent: map[string]float64{}}
}

func (s *SpendBook) add(team, enterprise, window string, cost float64) {
	if cost == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.team[team+"\x00"+window] += cost
	if enterprise != "" {
		s.ent[enterprise+"\x00"+window] += cost
	}
}

func (s *SpendBook) teamSpent(team, window string) float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.team[team+"\x00"+window]
}

func (s *SpendBook) entSpent(enterprise, window string) float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ent[enterprise+"\x00"+window]
}

func shanghaiDay(t time.Time) string {
	return t.In(shanghai()).Format("2006-01-02")
}

func shanghaiMonth(t time.Time) string {
	return t.In(shanghai()).Format("2006-01")
}
