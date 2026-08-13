#!/bin/sh
set -eu
BASE="${1:-http://127.0.0.1:3000}"
VK="${BOOTSTRAP_VIRTUAL_KEY:-fab-local-bootstrap-01}"
ADMIN="${ADMIN_TOKEN:-dev-local-admin-token}"

fail() { echo "smoke fail: $*" >&2; exit 1; }

code=$(curl -sS -o /tmp/th-health.json -w '%{http_code}' "$BASE/health")
[ "$code" = "200" ] || fail "health $code"
grep -q '"postgres":true' /tmp/th-health.json || fail "postgres not ok"
grep -q '"redis":true' /tmp/th-health.json || fail "redis not ok"

code=$(curl -sS -o /tmp/th-chat.json -w '%{http_code}' \
  -H "Authorization: Bearer $VK" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}' \
  "$BASE/v1/chat/completions")
[ "$code" = "200" ] || fail "chat $code $(cat /tmp/th-chat.json)"
grep -q 'hello-mock' /tmp/th-chat.json || fail "chat body"
grep -q 'total_tokens' /tmp/th-chat.json || fail "chat usage"

code=$(curl -sS -o /tmp/th-msg.json -w '%{http_code}' \
  -H "X-Api-Key: $VK" -H 'Content-Type: application/json' \
  -d '{"model":"claude","messages":[{"role":"user","content":"hi"}]}' \
  "$BASE/v1/messages")
[ "$code" = "200" ] || fail "messages $code $(cat /tmp/th-msg.json)"
grep -q 'hello-mock' /tmp/th-msg.json || fail "messages body"
grep -q 'mock-openai\|mock-anthropic\|sk-' /tmp/th-chat.json && fail "provider secret leaked in chat"
grep -q 'mock-openai\|mock-anthropic\|sk-' /tmp/th-msg.json && fail "provider secret leaked in messages"

code=$(curl -sS -o /tmp/th-sse.txt -w '%{http_code}' \
  -H "Authorization: Bearer $VK" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4","stream":true,"messages":[{"role":"user","content":"hi"}]}' \
  "$BASE/v1/chat/completions")
[ "$code" = "200" ] || fail "sse $code"
grep -q 'hello-stream' /tmp/th-sse.txt || fail "sse body"

CACHE_BODY='{"model":"gpt-4","messages":[{"role":"user","content":"cache-me"}],"fabric_context":{"preferences":{"cacheable":true}}}'
curl -sS -D /tmp/th-c1.h -o /dev/null -H "Authorization: Bearer $VK" -H 'Content-Type: application/json' -d "$CACHE_BODY" "$BASE/v1/chat/completions"
curl -sS -D /tmp/th-c2.h -o /dev/null -H "Authorization: Bearer $VK" -H 'Content-Type: application/json' -d "$CACHE_BODY" "$BASE/v1/chat/completions"
grep -qi 'X-Fabric-Cache: HIT' /tmp/th-c2.h || fail "cache hit missing"

# tight RPM VK for 429
vkjson=$(curl -sS -H "X-Admin-Token: $ADMIN" -H 'Content-Type: application/json' \
  -d '{"pool_id":1,"rpm_limit":60,"rpm_burst":1}' "$BASE/admin/v1/virtual-keys")
echo "$vkjson" | grep -q plaintext || fail "admin vk $vkjson"
rpmvk=$(echo "$vkjson" | sed -n 's/.*"plaintext":"\([^"]*\)".*/\1/p')
[ -n "$rpmvk" ] || fail "rpm vk parse"
curl -sS -o /dev/null -H "Authorization: Bearer $rpmvk" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4","messages":[]}' "$BASE/v1/chat/completions"
code=$(curl -sS -o /tmp/th-429.json -w '%{http_code}' \
  -H "Authorization: Bearer $rpmvk" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4","messages":[]}' "$BASE/v1/chat/completions")
[ "$code" = "429" ] || fail "want 429 got $code $(cat /tmp/th-429.json)"

# hard budget 402
vkjson=$(curl -sS -H "X-Admin-Token: $ADMIN" -H 'Content-Type: application/json' \
  -d '{"pool_id":1,"monthly_hard":1}' "$BASE/admin/v1/virtual-keys")
budvk=$(echo "$vkjson" | sed -n 's/.*"plaintext":"\([^"]*\)".*/\1/p')
code=$(curl -sS -o /tmp/th-402.json -w '%{http_code}' \
  -H "Authorization: Bearer $budvk" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4","messages":[],"max_tokens":5}' "$BASE/v1/chat/completions")
[ "$code" = "402" ] || fail "want 402 got $code $(cat /tmp/th-402.json)"

echo "smoke ok"
