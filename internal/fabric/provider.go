package fabric

import (
	"context"
	"sync"
)

// Provider is the outbound seam to an OpenAI-family upstream.
type Provider interface {
	ChatCompletions(ctx context.Context, rawBody []byte) (status int, header map[string]string, body []byte, err error)
}

// FixtureProvider replays a recorded Chat Completions body.
type FixtureProvider struct {
	Body  []byte
	mu    sync.Mutex
	calls int
}

func (p *FixtureProvider) ChatCompletions(ctx context.Context, rawBody []byte) (int, map[string]string, []byte, error) {
	p.mu.Lock()
	p.calls++
	p.mu.Unlock()
	select {
	case <-ctx.Done():
		return 0, nil, nil, ctx.Err()
	default:
	}
	_ = rawBody
	return 200, map[string]string{"Content-Type": "application/json"}, append([]byte(nil), p.Body...), nil
}

func (p *FixtureProvider) Calls() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls
}
