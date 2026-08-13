package hub

import (
	"context"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisLimiter shares VK/Provider RPM via Redis Lua. Circuit state stays
// in-process (V1 single replica); see docs/features/v0.1.0.md.
type RedisLimiter struct {
	*Limiter
	rdb *redis.Client
}

func NewRedisLimiter(rdb *redis.Client, clock Clock) *RedisLimiter {
	return &RedisLimiter{Limiter: NewLimiter(clock), rdb: rdb}
}

const rpmLua = `
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
local last = tonumber(redis.call('HGET', KEYS[1], 'last'))
local rpm = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
if burst < 1 then burst = 1 end
local burstm = burst * 1000
if tokens == nil then
  tokens = burstm
  last = now
end
local rate = rpm * 1000 / 60000.0
if now > last then
  tokens = tokens + (now - last) * rate
  if tokens > burstm then tokens = burstm end
  last = now
end
if tokens < 1000 then
  redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'last', tostring(last))
  return 0
end
tokens = tokens - 1000
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'last', tostring(last))
return 1
`

func (l *RedisLimiter) take(key string, rpm, burst int) bool {
	if l == nil || l.rdb == nil || rpm <= 0 {
		return true
	}
	if burst <= 0 {
		burst = 1
	}
	now := l.now().UnixMilli()
	res, err := l.rdb.Eval(context.Background(), rpmLua, []string{key}, rpm, burst, now).Int()
	if err != nil {
		return false
	}
	return res == 1
}

func (l *RedisLimiter) AllowVK(vkID int64, rpm, burst int) bool {
	if rpm <= 0 {
		return true
	}
	return l.take("th:rpm:vk:"+strconv.FormatInt(vkID, 10), rpm, burst)
}

func (l *RedisLimiter) AllowProvider(code string, rpm, burst int) bool {
	if rpm <= 0 || code == "" {
		return true
	}
	return l.take("th:rpm:prov:"+code, rpm, burst)
}

func (l *RedisLimiter) now() time.Time {
	if l != nil && l.Limiter != nil {
		return l.Limiter.now()
	}
	return time.Now()
}
