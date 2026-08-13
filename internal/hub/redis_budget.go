package hub

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/redis/go-redis/v9"
)

// RedisBudget is the production monthly ledger. On Redis errors, Reserve with
// hard>0 fail-closes (never falls back to per-process memory).
type RedisBudget struct {
	rdb *redis.Client
}

func NewRedisBudget(rdb *redis.Client) *RedisBudget {
	return &RedisBudget{rdb: rdb}
}

func budgetAccKey(vkID int64, month string) string {
	return fmt.Sprintf("th:budget:%d:%s", vkID, month)
}

func budgetLeaseKey(id int64) string {
	return fmt.Sprintf("th:lease:%d", id)
}

const reserveLua = `
local used = tonumber(redis.call('HGET', KEYS[1], 'used') or '0')
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')
local pending = tonumber(redis.call('HGET', KEYS[1], 'pending') or '0')
local hard = tonumber(ARGV[1])
local input = tonumber(ARGV[2])
local cap = tonumber(ARGV[3])
local hasCap = tonumber(ARGV[4])
if input < 0 then input = 0 end
local need = 0
if hasCap == 1 then
  if cap < 0 then cap = 0 end
  need = input + cap
  if need < 1 then need = 1 end
  if hard > 0 and (used + pending + reserved + need) > hard then
    return {0}
  end
else
  if hard > 0 then
    local rem = hard - used - pending - reserved
    if rem <= 0 or input > rem then
      return {0}
    end
    need = rem
  else
    need = input
  end
end
local id = redis.call('INCR', 'th:lease:seq')
redis.call('HINCRBY', KEYS[1], 'reserved', need)
redis.call('HSET', KEYS[2]..id, 'vk', ARGV[5], 'month', ARGV[6], 'need', need, 'remaining', need, 'observed', 0)
return {id, need}
`

const observeLua = `
local tokens = tonumber(ARGV[1])
if tokens <= 0 then return 0 end
if redis.call('EXISTS', KEYS[2]) == 0 then return 0 end
local remaining = tonumber(redis.call('HGET', KEYS[2], 'remaining') or '0')
redis.call('HINCRBY', KEYS[2], 'observed', tokens)
redis.call('HINCRBY', KEYS[1], 'pending', tokens)
local take = tokens
if take > remaining then take = remaining end
redis.call('HINCRBY', KEYS[2], 'remaining', -take)
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0') - take
if reserved < 0 then reserved = 0 end
redis.call('HSET', KEYS[1], 'reserved', reserved)
return 1
`

const settleLua = `
if redis.call('EXISTS', KEYS[2]) == 0 then return 0 end
local observed = tonumber(redis.call('HGET', KEYS[2], 'observed') or '0')
local remaining = tonumber(redis.call('HGET', KEYS[2], 'remaining') or '0')
local tokens = tonumber(ARGV[1])
if tokens < 0 then tokens = 0 end
local pending = tonumber(redis.call('HGET', KEYS[1], 'pending') or '0') - observed
if pending < 0 then pending = 0 end
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0') - remaining
if reserved < 0 then reserved = 0 end
redis.call('HINCRBY', KEYS[1], 'used', tokens)
redis.call('HSET', KEYS[1], 'pending', pending, 'reserved', reserved)
redis.call('DEL', KEYS[2])
return 1
`

const releaseLua = `
if redis.call('EXISTS', KEYS[2]) == 0 then return 0 end
local observed = tonumber(redis.call('HGET', KEYS[2], 'observed') or '0')
local remaining = tonumber(redis.call('HGET', KEYS[2], 'remaining') or '0')
local pending = tonumber(redis.call('HGET', KEYS[1], 'pending') or '0') - observed
if pending < 0 then pending = 0 end
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0') - remaining
if reserved < 0 then reserved = 0 end
redis.call('HSET', KEYS[1], 'pending', pending, 'reserved', reserved)
redis.call('DEL', KEYS[2])
return 1
`

func (b *RedisBudget) Reserve(vkID int64, month string, hard int64, spec ReserveSpec) (BudgetLease, bool) {
	if b == nil || b.rdb == nil {
		return BudgetLease{}, hard <= 0
	}
	hasCap := 0
	if spec.HasCap {
		hasCap = 1
	}
	acc := budgetAccKey(vkID, month)
	res, err := b.rdb.Eval(context.Background(), reserveLua, []string{acc, "th:lease:"},
		hard, spec.Input, spec.OutputCap, hasCap, vkID, month).Int64Slice()
	if err != nil {
		return BudgetLease{}, hard <= 0
	}
	if len(res) < 1 || res[0] == 0 {
		return BudgetLease{}, false
	}
	need := int64(0)
	if len(res) > 1 {
		need = res[1]
	}
	return BudgetLease{ID: res[0], VKID: vkID, Month: month, Reserved: need}, true
}

func (b *RedisBudget) Observe(lease BudgetLease, tokens int64) {
	if b == nil || b.rdb == nil || lease.ID == 0 || tokens <= 0 {
		return
	}
	_ = b.rdb.Eval(context.Background(), observeLua,
		[]string{budgetAccKey(lease.VKID, lease.Month), budgetLeaseKey(lease.ID)}, tokens).Err()
}

func (b *RedisBudget) Settle(lease BudgetLease, tokens int64) BudgetSnap {
	if b == nil || b.rdb == nil || lease.ID == 0 {
		return BudgetSnap{VirtualKeyID: lease.VKID, Month: lease.Month}
	}
	_ = b.rdb.Eval(context.Background(), settleLua,
		[]string{budgetAccKey(lease.VKID, lease.Month), budgetLeaseKey(lease.ID)}, tokens).Err()
	return b.Snap(lease.VKID, lease.Month)
}

func (b *RedisBudget) Release(lease BudgetLease) {
	if b == nil || b.rdb == nil || lease.ID == 0 {
		return
	}
	_ = b.rdb.Eval(context.Background(), releaseLua,
		[]string{budgetAccKey(lease.VKID, lease.Month), budgetLeaseKey(lease.ID)}).Err()
}

func (b *RedisBudget) Snap(vkID int64, month string) BudgetSnap {
	if b == nil || b.rdb == nil {
		return BudgetSnap{VirtualKeyID: vkID, Month: month}
	}
	m, err := b.rdb.HGetAll(context.Background(), budgetAccKey(vkID, month)).Result()
	if err != nil {
		return BudgetSnap{VirtualKeyID: vkID, Month: month}
	}
	used := atoi64(m["used"])
	pending := atoi64(m["pending"])
	return BudgetSnap{VirtualKeyID: vkID, Used: used + pending, Settled: used, Reserved: atoi64(m["reserved"]), Month: month}
}

func (b *RedisBudget) All() []BudgetSnap {
	if b == nil || b.rdb == nil {
		return nil
	}
	var out []BudgetSnap
	var cursor uint64
	for {
		keys, next, err := b.rdb.Scan(context.Background(), cursor, "th:budget:*", 64).Result()
		if err != nil {
			return out
		}
		for _, k := range keys {
			rest := strings.TrimPrefix(k, "th:budget:")
			vkRaw, month, _ := strings.Cut(rest, ":")
			id, _ := strconv.ParseInt(vkRaw, 10, 64)
			out = append(out, b.Snap(id, month))
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return out
}
