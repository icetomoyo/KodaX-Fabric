package fabric

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"
	"sync"
	"time"
)

// Provider is the outbound seam to an upstream family.
type Provider interface {
	ChatCompletions(ctx context.Context, rawBody []byte) (status int, header map[string]string, body io.ReadCloser, err error)
	Messages(ctx context.Context, rawBody []byte) (status int, header map[string]string, body io.ReadCloser, err error)
}

// FixtureProvider replays a recorded Chat Completions body (JSON or SSE).
type FixtureProvider struct {
	Body               []byte
	StreamBody         []byte
	MessagesBody       []byte
	MessagesStreamBody []byte
	ChunkDelay         time.Duration

	mu        sync.Mutex
	calls     int
	emitted   int
	cancelled bool
}

func (p *FixtureProvider) ChatCompletions(ctx context.Context, rawBody []byte) (int, map[string]string, io.ReadCloser, error) {
	return p.replay(ctx, rawBody, p.Body, p.StreamBody)
}

func (p *FixtureProvider) Messages(ctx context.Context, rawBody []byte) (int, map[string]string, io.ReadCloser, error) {
	return p.replay(ctx, rawBody, p.MessagesBody, p.MessagesStreamBody)
}

func (p *FixtureProvider) replay(ctx context.Context, rawBody, jsonBody, sseBody []byte) (int, map[string]string, io.ReadCloser, error) {
	p.mu.Lock()
	p.calls++
	p.emitted = 0
	p.cancelled = false
	p.mu.Unlock()
	select {
	case <-ctx.Done():
		return 0, nil, nil, ctx.Err()
	default:
	}
	if wantsStream(rawBody) && len(sseBody) > 0 {
		header := map[string]string{"Content-Type": "text/event-stream"}
		body := append([]byte(nil), sseBody...)
		if p.ChunkDelay <= 0 {
			p.markChunk()
			return 200, header, io.NopCloser(bytes.NewReader(body)), nil
		}
		return 200, header, newChunkReader(ctx, p, body, p.ChunkDelay), nil
	}
	return 200, map[string]string{"Content-Type": "application/json"}, io.NopCloser(bytes.NewReader(append([]byte(nil), jsonBody...))), nil
}

func (p *FixtureProvider) Calls() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls
}

func (p *FixtureProvider) ChunksEmitted() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.emitted
}

func (p *FixtureProvider) Cancelled() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.cancelled
}

func (p *FixtureProvider) markChunk() {
	p.mu.Lock()
	p.emitted++
	p.mu.Unlock()
}

func (p *FixtureProvider) markCancel() {
	p.mu.Lock()
	p.cancelled = true
	p.mu.Unlock()
}

func wantsStream(raw []byte) bool {
	var head struct {
		Stream bool `json:"stream"`
	}
	_ = json.Unmarshal(raw, &head)
	return head.Stream
}

type chunkReader struct {
	ctx    context.Context
	prov   *FixtureProvider
	chunks [][]byte
	delay  time.Duration
	idx    int
	buf    []byte
}

func newChunkReader(ctx context.Context, p *FixtureProvider, body []byte, delay time.Duration) io.ReadCloser {
	parts := splitSSE(body)
	return &chunkReader{ctx: ctx, prov: p, chunks: parts, delay: delay}
}

func splitSSE(body []byte) [][]byte {
	raw := string(body)
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	blocks := strings.Split(raw, "\n\n")
	var out [][]byte
	for i, b := range blocks {
		if strings.TrimSpace(b) == "" {
			continue
		}
		chunk := b + "\n\n"
		if i == len(blocks)-1 && !strings.HasSuffix(string(body), "\n") {
			chunk = b
		}
		out = append(out, []byte(chunk))
	}
	if len(out) == 0 {
		return [][]byte{append([]byte(nil), body...)}
	}
	return out
}

func (r *chunkReader) Read(p []byte) (int, error) {
	if len(r.buf) == 0 {
		if r.idx >= len(r.chunks) {
			return 0, io.EOF
		}
		if r.delay > 0 && r.idx > 0 {
			select {
			case <-r.ctx.Done():
				r.prov.markCancel()
				return 0, r.ctx.Err()
			case <-time.After(r.delay):
			}
		} else {
			select {
			case <-r.ctx.Done():
				r.prov.markCancel()
				return 0, r.ctx.Err()
			default:
			}
		}
		r.buf = r.chunks[r.idx]
		r.idx++
		r.prov.markChunk()
	}
	n := copy(p, r.buf)
	r.buf = r.buf[n:]
	return n, nil
}

func (r *chunkReader) Close() error {
	select {
	case <-r.ctx.Done():
		r.prov.markCancel()
	default:
	}
	return nil
}
