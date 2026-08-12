package hub

import (
	"sync"
	"time"
)

type Limiter struct {
	mu   sync.Mutex
	rpm  map[int64]bucket
	fail map[int64]breaker
}

type bucket struct {
	minute int64
	count  int
}

type breaker struct {
	fails    int
	openUntil time.Time
}

func NewLimiter() *Limiter {
	return &Limiter{rpm: map[int64]bucket{}, fail: map[int64]breaker{}}
}

func (l *Limiter) AllowRPM(vkID int64, limit int) bool {
	if l == nil || limit <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	min := time.Now().Unix() / 60
	b := l.rpm[vkID]
	if b.minute != min {
		b = bucket{minute: min, count: 0}
	}
	if b.count >= limit {
		l.rpm[vkID] = b
		return false
	}
	b.count++
	l.rpm[vkID] = b
	return true
}

func (l *Limiter) ChannelOpen(channelID int64) bool {
	if l == nil {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.fail[channelID]
	return time.Now().After(b.openUntil)
}

func (l *Limiter) RecordSuccess(channelID int64) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fail[channelID] = breaker{}
}

func (l *Limiter) RecordFailure(channelID int64) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.fail[channelID]
	b.fails++
	if b.fails >= 2 {
		b.openUntil = time.Now().Add(15 * time.Second)
		b.fails = 0
	}
	l.fail[channelID] = b
}
