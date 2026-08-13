package hub

import (
	"sync"
	"time"
)

const (
	brkClosed = iota
	brkOpen
	brkHalf
)

type breaker struct {
	mu       sync.Mutex
	outcomes []bool
	state    int
	openedAt time.Time
	halfUsed int
}

func (s *Server) brkWindow() int {
	if s.BreakerWindow > 0 {
		return s.BreakerWindow
	}
	return 5
}

func (s *Server) brkMinFail() int {
	if s.BreakerMinFail > 0 {
		return s.BreakerMinFail
	}
	return 3
}

func (s *Server) brkRate() float64 {
	if s.BreakerOpenRate > 0 {
		return s.BreakerOpenRate
	}
	return 0.20
}

func (s *Server) brkCool() time.Duration {
	if s.BreakerCoolDown > 0 {
		return s.BreakerCoolDown
	}
	return 30 * time.Second
}

func (s *Server) brkHalf() int {
	if s.BreakerHalfProbes > 0 {
		return s.BreakerHalfProbes
	}
	return 3
}

func (s *Server) brk(id int64) *breaker {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.breakers == nil {
		s.breakers = map[int64]*breaker{}
	}
	b := s.breakers[id]
	if b == nil {
		b = &breaker{}
		s.breakers[id] = b
	}
	return b
}

func (s *Server) channelAllowed(id int64, now time.Time) bool {
	b := s.brk(id)
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case brkOpen:
		if now.Sub(b.openedAt) >= s.brkCool() {
			b.state = brkHalf
			b.halfUsed = 0
		} else {
			return false
		}
		fallthrough
	case brkHalf:
		if b.halfUsed >= s.brkHalf() {
			return false
		}
		b.halfUsed++
		return true
	default:
		return true
	}
}

func (s *Server) observeChannel(id int64, ok bool, now time.Time) {
	b := s.brk(id)
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.state == brkHalf {
		if ok {
			b.state = brkClosed
			b.outcomes = nil
			b.halfUsed = 0
			return
		}
		b.state = brkOpen
		b.openedAt = now
		b.halfUsed = 0
		return
	}
	if b.state != brkClosed {
		return
	}
	b.outcomes = append(b.outcomes, ok)
	if w := s.brkWindow(); len(b.outcomes) > w {
		b.outcomes = b.outcomes[len(b.outcomes)-w:]
	}
	fails := 0
	for _, o := range b.outcomes {
		if !o {
			fails++
		}
	}
	if fails >= s.brkMinFail() && float64(fails)/float64(len(b.outcomes)) > s.brkRate() {
		b.state = brkOpen
		b.openedAt = now
	}
}
