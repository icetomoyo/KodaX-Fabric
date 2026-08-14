package hub

import (
	"math"
	"sync"
	"time"

	"kodax-fabric/internal/store"
)

type tokenBucket struct {
	mu     sync.Mutex
	tokens float64
	last   time.Time
	inited bool
}

func burstCapacity(rpm int) float64 {
	if rpm <= 0 {
		return 0
	}
	c := math.Ceil(float64(rpm) * 1.2)
	if c < float64(rpm) {
		c = float64(rpm)
	}
	return c
}

func (b *tokenBucket) refill(now time.Time, rpm int) {
	cap := burstCapacity(rpm)
	if !b.inited {
		b.tokens = cap
		b.last = now
		b.inited = true
		return
	}
	if elapsed := now.Sub(b.last).Seconds(); elapsed > 0 {
		b.tokens += elapsed * (float64(rpm) / 60)
		if b.tokens > cap {
			b.tokens = cap
		}
		b.last = now
	}
}

func (b *tokenBucket) available(now time.Time, rpm int) bool {
	if rpm <= 0 {
		return true
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.refill(now, rpm)
	return b.tokens >= 1
}

func (b *tokenBucket) take(now time.Time, rpm int) bool {
	if rpm <= 0 {
		return true
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.refill(now, rpm)
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (s *Server) vkHasQuota(vkID int64, rpm int, now time.Time) bool {
	if rpm <= 0 {
		return true
	}
	return s.vkBucket(vkID).available(now, rpm)
}

func (s *Server) allowVK(vkID int64, rpm int, now time.Time) bool {
	if rpm <= 0 {
		return true
	}
	return s.vkBucket(vkID).take(now, rpm)
}

func (s *Server) vkBucket(vkID int64) *tokenBucket {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.vkBuckets == nil {
		s.vkBuckets = map[int64]*tokenBucket{}
	}
	b := s.vkBuckets[vkID]
	if b == nil {
		b = &tokenBucket{}
		s.vkBuckets[vkID] = b
	}
	return b
}

func (s *Server) providerBucket(code string) *tokenBucket {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.provBuckets == nil {
		s.provBuckets = map[string]*tokenBucket{}
	}
	b := s.provBuckets[code]
	if b == nil {
		b = &tokenBucket{}
		s.provBuckets[code] = b
	}
	return b
}

func providerLimit(resolved *store.ResolvedVK, code string) int {
	if resolved == nil || code == "" || resolved.ProviderRPM == nil {
		return 0
	}
	return resolved.ProviderRPM[code]
}

func (s *Server) providerOK(resolved *store.ResolvedVK, code string, now time.Time) bool {
	lim := providerLimit(resolved, code)
	if lim <= 0 {
		return true
	}
	return s.providerBucket(code).available(now, lim)
}

func (s *Server) takeProvider(resolved *store.ResolvedVK, code string, now time.Time) {
	lim := providerLimit(resolved, code)
	if lim <= 0 {
		return
	}
	s.providerBucket(code).take(now, lim)
}
