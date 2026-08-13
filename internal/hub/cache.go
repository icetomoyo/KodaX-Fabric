package hub

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"kodax-fabric/internal/store"
)

type CacheEntry struct {
	Status int
	Header http.Header
	Body   []byte
	Tokens int64
	Exp    time.Time
}

type CacheStats struct {
	Candidates  int64 `json:"candidates"`
	Hits        int64 `json:"hits"`
	Misses      int64 `json:"misses"`
	Writes      int64 `json:"writes"`
	TokensSaved int64 `json:"tokens_saved"`
}

type ResponseCache interface {
	Get(key string) (CacheEntry, bool)
	Set(key string, e CacheEntry)
	Stats() CacheStats
}

type MemoryCache struct {
	mu    sync.Mutex
	by    map[string]CacheEntry
	ttl   time.Duration
	clock Clock
	cand  atomic.Int64
	hit   atomic.Int64
	miss  atomic.Int64
	write atomic.Int64
	saved atomic.Int64
}

func ParseCacheTTL(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Hour, nil
	}
	d, err := time.ParseDuration(s)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("invalid CACHE_TTL %q", s)
	}
	return d, nil
}

func NewMemoryCache(clock Clock, ttl time.Duration) *MemoryCache {
	if ttl <= 0 {
		ttl = time.Hour
	}
	return &MemoryCache{by: map[string]CacheEntry{}, ttl: ttl, clock: clock}
}

func (c *MemoryCache) now() time.Time {
	if c != nil && c.clock != nil {
		return c.clock.Now()
	}
	return time.Now()
}

func (c *MemoryCache) Get(key string) (CacheEntry, bool) {
	if c == nil {
		return CacheEntry{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.by[key]
	if !ok {
		return CacheEntry{}, false
	}
	if !c.now().Before(e.Exp) {
		delete(c.by, key)
		return CacheEntry{}, false
	}
	return e, true
}

func (c *MemoryCache) Set(key string, e CacheEntry) {
	if c == nil {
		return
	}
	if e.Exp.IsZero() {
		e.Exp = c.now().Add(c.ttl)
	}
	c.mu.Lock()
	c.by[key] = e
	c.mu.Unlock()
}

func (c *MemoryCache) noteCandidate() { c.cand.Add(1) }
func (c *MemoryCache) noteHit(tok int64) {
	c.hit.Add(1)
	c.saved.Add(tok)
}
func (c *MemoryCache) noteMiss()         { c.miss.Add(1) }
func (c *MemoryCache) noteWrite(n int64) { c.write.Add(1) }

func (c *MemoryCache) Stats() CacheStats {
	if c == nil {
		return CacheStats{}
	}
	return CacheStats{
		Candidates:  c.cand.Load(),
		Hits:        c.hit.Load(),
		Misses:      c.miss.Load(),
		Writes:      c.write.Load(),
		TokensSaved: c.saved.Load(),
	}
}

func cacheKey(protocol string, vk *store.ResolvedVK, model string, body []byte) string {
	sum := sha256.Sum256(body)
	var vkID, project, team int64
	if vk != nil {
		vkID, project, team = vk.VirtualKeyID, vk.ProjectID, vk.TeamID
	}
	return fmt.Sprintf("%s|%d|%d|%d|%s|%s", protocol, vkID, project, team, model, hex.EncodeToString(sum[:]))
}

func wantsResponseCache(h http.Header, body []byte) bool {
	if h != nil {
		if raw := h.Get("X-Fabric-Context"); raw != "" && prefCacheable([]byte(raw)) {
			return true
		}
	}
	return prefCacheable(body)
}

func prefCacheable(raw []byte) bool {
	var wrap struct {
		Preferences struct {
			Cacheable bool `json:"cacheable"`
		} `json:"preferences"`
		FabricContext *struct {
			Preferences struct {
				Cacheable bool `json:"cacheable"`
			} `json:"preferences"`
		} `json:"fabric_context"`
	}
	if json.Unmarshal(raw, &wrap) != nil {
		return false
	}
	if wrap.Preferences.Cacheable {
		return true
	}
	return wrap.FabricContext != nil && wrap.FabricContext.Preferences.Cacheable
}

func safeCacheHeaders(src http.Header) http.Header {
	out := make(http.Header)
	for k, vs := range src {
		if !cacheableHeader(k) {
			continue
		}
		for _, v := range vs {
			out.Add(k, v)
		}
	}
	return out
}

func cacheableHeader(k string) bool {
	return strings.EqualFold(k, "Content-Type")
}

func extractCachedTokens(u usageBits) int64 {
	if u.Cached > 0 {
		return u.Cached
	}
	return u.CacheRead
}
