package hub

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

const (
	defaultCacheTTL = time.Hour
	maxRespCache    = 1024
)

type cacheEntry struct {
	status int
	header http.Header
	body   []byte
	exp    time.Time
}

func requestCacheable(r *http.Request, body []byte) bool {
	if v := strings.TrimSpace(r.Header.Get("X-Fabric-Cacheable")); strings.EqualFold(v, "true") || v == "1" {
		return true
	}
	var wrap struct {
		FabricContext struct {
			Cacheable bool `json:"cacheable"`
		} `json:"fabric_context"`
	}
	_ = json.Unmarshal(body, &wrap)
	return wrap.FabricContext.Cacheable
}

func canonicalizeJSON(body []byte) []byte {
	var v any
	if err := json.Unmarshal(body, &v); err != nil {
		return body
	}
	out, err := json.Marshal(v)
	if err != nil {
		return body
	}
	return out
}

func responseCacheKey(protocol, model string, body []byte) string {
	sum := sha256.Sum256(append([]byte(protocol+"|"+model+"|"), canonicalizeJSON(body)...))
	return hex.EncodeToString(sum[:])
}

func (s *Server) cacheTTL() time.Duration {
	if s.CacheTTL > 0 {
		return s.CacheTTL
	}
	return defaultCacheTTL
}

func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Server) cacheGet(key string) (upResult, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.respCache == nil {
		return upResult{}, false
	}
	e, ok := s.respCache[key]
	if !ok {
		return upResult{}, false
	}
	if !e.exp.IsZero() && !s.now().Before(e.exp) {
		delete(s.respCache, key)
		return upResult{}, false
	}
	h := e.header.Clone()
	b := append([]byte(nil), e.body...)
	return upResult{status: e.status, header: h, body: b}, true
}

func (s *Server) evictRespCacheLocked(now time.Time) {
	for k, e := range s.respCache {
		if !e.exp.IsZero() && !now.Before(e.exp) {
			delete(s.respCache, k)
		}
	}
	for len(s.respCache) >= maxRespCache {
		for k := range s.respCache {
			delete(s.respCache, k)
			break
		}
	}
}

func (s *Server) cachePut(key string, res upResult) {
	if key == "" || res.status < 200 || res.status >= 300 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.respCache == nil {
		s.respCache = map[string]cacheEntry{}
	}
	now := s.now()
	s.evictRespCacheLocked(now)
	h := http.Header{}
	if res.header != nil {
		h = res.header.Clone()
	}
	s.respCache[key] = cacheEntry{
		status: res.status, header: h, body: append([]byte(nil), res.body...),
		exp: now.Add(s.cacheTTL()),
	}
}
