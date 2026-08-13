package hub

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	redisCachePrefix = "th:cache:"
	redisCacheStats  = "th:cache:stats"
)

type RedisCache struct {
	rdb *redis.Client
	ttl time.Duration
}

func NewRedisCache(rdb *redis.Client, ttl time.Duration) *RedisCache {
	if ttl <= 0 {
		ttl = time.Hour
	}
	return &RedisCache{rdb: rdb, ttl: ttl}
}

type redisCachePayload struct {
	Status int                 `json:"status"`
	Header map[string][]string `json:"header"`
	Body   []byte              `json:"body"`
	Tokens int64               `json:"tokens"`
}

func (c *RedisCache) Get(key string) (CacheEntry, bool) {
	if c == nil || c.rdb == nil {
		return CacheEntry{}, false
	}
	raw, err := c.rdb.Get(context.Background(), redisCachePrefix+key).Bytes()
	if err != nil {
		return CacheEntry{}, false
	}
	var p redisCachePayload
	if json.Unmarshal(raw, &p) != nil {
		return CacheEntry{}, false
	}
	return CacheEntry{Status: p.Status, Header: p.Header, Body: p.Body, Tokens: p.Tokens}, true
}

func (c *RedisCache) Set(key string, e CacheEntry) {
	if c == nil || c.rdb == nil {
		return
	}
	p := redisCachePayload{Status: e.Status, Header: map[string][]string(safeCacheHeaders(e.Header)), Body: e.Body, Tokens: e.Tokens}
	raw, err := json.Marshal(p)
	if err != nil {
		return
	}
	_ = c.rdb.Set(context.Background(), redisCachePrefix+key, raw, c.ttl).Err()
}

func (c *RedisCache) NoteCandidate() { c.incr("candidates", 1) }
func (c *RedisCache) NoteHit(tok int64) {
	c.incr("hits", 1)
	c.incr("tokens_saved", tok)
}
func (c *RedisCache) NoteMiss()         { c.incr("misses", 1) }
func (c *RedisCache) NoteWrite(_ int64) { c.incr("writes", 1) }

func (c *RedisCache) incr(field string, n int64) {
	if c == nil || c.rdb == nil || n == 0 {
		return
	}
	_ = c.rdb.HIncrBy(context.Background(), redisCacheStats, field, n).Err()
}

func (c *RedisCache) Stats() CacheStats {
	if c == nil || c.rdb == nil {
		return CacheStats{}
	}
	m, err := c.rdb.HGetAll(context.Background(), redisCacheStats).Result()
	if err != nil {
		return CacheStats{}
	}
	return CacheStats{
		Candidates:  atoi64(m["candidates"]),
		Hits:        atoi64(m["hits"]),
		Misses:      atoi64(m["misses"]),
		Writes:      atoi64(m["writes"]),
		TokensSaved: atoi64(m["tokens_saved"]),
	}
}

func atoi64(s string) int64 {
	var n int64
	for _, c := range s {
		if c < '0' || c > '9' {
			if c == '-' {
				return 0
			}
			continue
		}
		n = n*10 + int64(c-'0')
	}
	return n
}
