package hub

import (
	"sync"
	"time"

	"kodax-fabric/internal/store"
)

// HotLimits is in-process for 0.0.6. A Redis implementation can replace it at 0.1.0.
type HotLimits interface {
	AllowVK(vkID int64, rpm, burst int) bool
	AllowProvider(code string, rpm, burst int) bool
	AllowChannel(poolID, chID int64) bool
	ReleaseChannel(chID int64)
	Record(poolID, chID int64, latency time.Duration, ok, retryable bool)
	RegisterPool(poolID int64, chs []store.Channel)
	DueProbes() []store.Channel
	Tick()
	Snapshot() LimitSnapshot
}

type Clock interface {
	Now() time.Time
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

type FakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func NewFakeClock(t time.Time) *FakeClock { return &FakeClock{t: t} }

func (f *FakeClock) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.t
}

func (f *FakeClock) Advance(d time.Duration) {
	f.mu.Lock()
	f.t = f.t.Add(d)
	f.mu.Unlock()
}

const (
	circuitClosed = iota
	circuitOpen
	circuitHalfOpen

	defaultFailThreshold = 2
	defaultOpenFor       = 15 * time.Second
	windowSize           = 10
)

type tokenBucket struct {
	tokens float64
	burst  float64
	rate   float64
	last   time.Time
}

type circuit struct {
	state     int
	fails     int
	openUntil time.Time
	probing   bool
	window    []bool
	latencies []time.Duration
	poolID    int64
}

type chReg struct {
	ch     store.Channel
	poolID int64
	rpm    int
}

type Limiter struct {
	mu        sync.Mutex
	clock     Clock
	vk        map[int64]*tokenBucket
	providers map[string]*tokenBucket
	circuits  map[int64]*circuit
	regs      map[int64]chReg
}

func NewLimiter(clock Clock) *Limiter {
	if clock == nil {
		clock = realClock{}
	}
	return &Limiter{
		clock:     clock,
		vk:        map[int64]*tokenBucket{},
		providers: map[string]*tokenBucket{},
		circuits:  map[int64]*circuit{},
		regs:      map[int64]chReg{},
	}
}

func (l *Limiter) now() time.Time {
	if l == nil || l.clock == nil {
		return time.Now()
	}
	return l.clock.Now()
}

func (l *Limiter) AllowVK(vkID int64, rpm, burst int) bool {
	if l == nil || rpm <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.vk[vkID]
	if b == nil {
		b = newBucket(rpm, burst, l.now())
		l.vk[vkID] = b
	} else {
		b.configure(rpm, burst, l.now())
	}
	return b.take(l.now())
}

func (l *Limiter) AllowProvider(code string, rpm, burst int) bool {
	if l == nil || rpm <= 0 || code == "" {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.providers[code]
	if b == nil {
		b = newBucket(rpm, burst, l.now())
		l.providers[code] = b
	} else {
		b.configure(rpm, burst, l.now())
	}
	return b.take(l.now())
}

func (l *Limiter) AllowChannel(poolID, chID int64) bool {
	if l == nil {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	c := l.circ(poolID, chID)
	now := l.now()
	switch c.state {
	case circuitClosed:
		return true
	case circuitOpen:
		if now.Before(c.openUntil) {
			return false
		}
		c.state = circuitHalfOpen
		c.probing = true
		return true
	case circuitHalfOpen:
		if c.probing {
			return false
		}
		c.probing = true
		return true
	default:
		return true
	}
}

func (l *Limiter) ReleaseChannel(chID int64) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	c := l.circuits[chID]
	if c == nil {
		return
	}
	if c.probing {
		c.probing = false
		if c.state == circuitHalfOpen {
			// stay half-open so a later probe can run
			c.state = circuitHalfOpen
		}
	}
}

func (l *Limiter) Record(poolID, chID int64, latency time.Duration, ok, retryable bool) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	c := l.circ(poolID, chID)
	if latency > 0 {
		c.latencies = append(c.latencies, latency)
		if len(c.latencies) > windowSize {
			c.latencies = c.latencies[len(c.latencies)-windowSize:]
		}
	}
	if ok {
		c.window = append(c.window, true)
		c.fails = 0
		c.state = circuitClosed
		c.probing = false
		c.openUntil = time.Time{}
	} else if retryable {
		c.window = append(c.window, false)
		c.fails++
		if c.state == circuitHalfOpen || c.fails >= defaultFailThreshold || lowSuccess(c.window) {
			c.state = circuitOpen
			c.probing = false
			c.openUntil = l.now().Add(defaultOpenFor)
			c.fails = 0
		}
	}
	if len(c.window) > windowSize {
		c.window = c.window[len(c.window)-windowSize:]
	}
}

func (l *Limiter) RegisterPool(poolID int64, chs []store.Channel) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, ch := range chs {
		l.regs[ch.ID] = chReg{ch: ch, poolID: poolID, rpm: ch.ProviderRPM}
		c := l.circ(poolID, ch.ID)
		c.poolID = poolID
	}
}

func (l *Limiter) DueProbes() []store.Channel {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	var out []store.Channel
	for id, reg := range l.regs {
		c := l.circuits[id]
		if c == nil {
			continue
		}
		due := false
		switch c.state {
		case circuitOpen:
			due = !now.Before(c.openUntil) && !c.probing
		case circuitHalfOpen:
			due = !c.probing
		}
		if due {
			out = append(out, reg.ch)
		}
	}
	return out
}

func (l *Limiter) Tick() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	for _, c := range l.circuits {
		if c.state == circuitOpen && !now.Before(c.openUntil) && !c.probing {
			c.state = circuitHalfOpen
		}
	}
}

func (l *Limiter) Snapshot() LimitSnapshot {
	if l == nil {
		return LimitSnapshot{}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	pools := map[int64]*PoolHealth{}
	ids := map[int64]struct{}{}
	for id, reg := range l.regs {
		ids[id] = struct{}{}
		p := pools[reg.poolID]
		if p == nil {
			p = &PoolHealth{PoolID: reg.poolID}
			pools[reg.poolID] = p
		}
		p.Total++
		p.RPMCapacity += reg.rpm
		c := l.circuits[id]
		st := "closed"
		fails := 0
		sr := 1.0
		if c != nil {
			fails = c.fails
			sr = successRate(c.window)
			switch c.state {
			case circuitOpen:
				if now.Before(c.openUntil) {
					st = "open"
				} else {
					st = "half_open"
				}
			case circuitHalfOpen:
				st = "half_open"
			}
		}
		if st == "closed" {
			p.Healthy++
			p.RPMAvailable += reg.rpm
		}
		p.Channels = append(p.Channels, ChannelHealth{
			ID: id, State: st, Fails: fails, SuccessRate: sr,
		})
	}
	for id, c := range l.circuits {
		if _, ok := ids[id]; ok {
			continue
		}
		p := pools[c.poolID]
		if p == nil {
			p = &PoolHealth{PoolID: c.poolID}
			pools[c.poolID] = p
		}
		p.Total++
		st := "closed"
		switch c.state {
		case circuitOpen:
			if now.Before(c.openUntil) {
				st = "open"
			} else {
				st = "half_open"
			}
		case circuitHalfOpen:
			st = "half_open"
		}
		if st == "closed" {
			p.Healthy++
		}
		p.Channels = append(p.Channels, ChannelHealth{ID: id, State: st, Fails: c.fails, SuccessRate: successRate(c.window)})
	}
	out := LimitSnapshot{}
	for _, p := range pools {
		out.Pools = append(out.Pools, *p)
	}
	for id, b := range l.vk {
		b.refill(now)
		out.VK = append(out.VK, BucketView{ID: id, Tokens: b.tokens, Burst: b.burst})
	}
	for code, b := range l.providers {
		b.refill(now)
		out.Providers = append(out.Providers, BucketView{Code: code, Tokens: b.tokens, Burst: b.burst})
	}
	return out
}

func (l *Limiter) circ(poolID, chID int64) *circuit {
	c := l.circuits[chID]
	if c == nil {
		c = &circuit{poolID: poolID}
		l.circuits[chID] = c
	}
	if poolID != 0 {
		c.poolID = poolID
	}
	return c
}

func newBucket(rpm, burst int, now time.Time) *tokenBucket {
	if burst <= 0 {
		burst = 1
	}
	return &tokenBucket{tokens: float64(burst), burst: float64(burst), rate: float64(rpm) / 60.0, last: now}
}

func (b *tokenBucket) configure(rpm, burst int, now time.Time) {
	if burst <= 0 {
		burst = 1
	}
	b.refill(now)
	b.rate = float64(rpm) / 60.0
	b.burst = float64(burst)
	if b.tokens > b.burst {
		b.tokens = b.burst
	}
}

func (b *tokenBucket) refill(now time.Time) {
	if b.last.IsZero() {
		b.last = now
		return
	}
	dt := now.Sub(b.last).Seconds()
	if dt > 0 {
		b.tokens += dt * b.rate
		if b.tokens > b.burst {
			b.tokens = b.burst
		}
		b.last = now
	}
}

func (b *tokenBucket) take(now time.Time) bool {
	b.refill(now)
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func lowSuccess(w []bool) bool {
	if len(w) < 5 {
		return false
	}
	return successRate(w) < 0.8
}

func successRate(w []bool) float64 {
	if len(w) == 0 {
		return 1
	}
	ok := 0
	for _, v := range w {
		if v {
			ok++
		}
	}
	return float64(ok) / float64(len(w))
}

type LimitSnapshot struct {
	Pools     []PoolHealth `json:"pools"`
	VK        []BucketView `json:"vk"`
	Providers []BucketView `json:"providers"`
}

type PoolHealth struct {
	PoolID       int64           `json:"pool_id"`
	Healthy      int             `json:"healthy_channels"`
	Total        int             `json:"channels"`
	RPMCapacity  int             `json:"rpm_capacity"`
	RPMAvailable int             `json:"rpm_available"`
	Channels     []ChannelHealth `json:"channel_states"`
}

type ChannelHealth struct {
	ID          int64   `json:"id"`
	State       string  `json:"state"`
	Fails       int     `json:"fails"`
	SuccessRate float64 `json:"success_rate"`
}

type BucketView struct {
	ID     int64   `json:"id,omitempty"`
	Code   string  `json:"code,omitempty"`
	Tokens float64 `json:"tokens"`
	Burst  float64 `json:"burst"`
}
