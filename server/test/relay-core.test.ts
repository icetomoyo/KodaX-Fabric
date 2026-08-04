import assert from "node:assert/strict";
import test from "node:test";
import type { RelayCandidate } from "../src/lib/relay/types.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { parseRelayUsage, sanitizeRelayHeaderRecord } = await import(
  "../src/lib/relay/audit.js"
);
const { orderRelayCandidates } = await import("../src/lib/relay/routing.js");
const { SseAuditInspector, createSsePassthrough } = await import(
  "../src/lib/relay/sse.js"
);
const { buildRelayUpstreamChatUrl } = await import("../src/lib/relay/upstream.js");

function candidate(
  credentialId: number,
  overrides: Partial<RelayCandidate> = {},
): RelayCandidate {
  return {
    routeId: credentialId,
    routePriority: 0,
    routeWeight: 100,
    clientModel: "client-model",
    upstreamModel: `upstream-${credentialId}`,
    providerCode: "test",
    authStyle: "bearer",
    productLineId: 1,
    productType: "api",
    retryPolicy: null,
    credentialId,
    credentialSuffix: String(credentialId),
    secretEncrypted: "encrypted",
    baseUrl: "https://example.test/v1",
    credentialPriority: 0,
    credentialWeight: 100,
    ...overrides,
  };
}

test("relay candidates are ordered by route then credential priority", () => {
  const result = orderRelayCandidates(
    [
      candidate(1, { routePriority: 0, credentialPriority: 100 }),
      candidate(2, { routePriority: 10, credentialPriority: 0 }),
      candidate(3, { routePriority: 10, credentialPriority: 20 }),
    ],
    () => 0,
  );

  assert.deepEqual(result.map((item) => item.credentialId), [3, 2, 1]);
});

test("equal-rank duplicate routes are weighted before credential deduplication", () => {
  const result = orderRelayCandidates(
    [
      candidate(1, { routeId: 10, upstreamModel: "low-weight", routeWeight: 1 }),
      candidate(1, { routeId: 11, upstreamModel: "high-weight", routeWeight: 99 }),
      candidate(2, { routeId: 12, upstreamModel: "other", routeWeight: 100 }),
    ],
    () => 0.2,
  );

  assert.equal(result.filter((item) => item.credentialId === 1).length, 1);
  assert.equal(result.find((item) => item.credentialId === 1)?.upstreamModel, "high-weight");
});

test("zero-weight candidates are excluded", () => {
  const result = orderRelayCandidates([
    candidate(1, { routeWeight: 0 }),
    candidate(2, { credentialWeight: 0 }),
    candidate(3),
  ]);

  assert.deepEqual(result.map((item) => item.credentialId), [3]);
});

test("audit headers are allowlisted case-insensitively", () => {
  assert.deepEqual(
    sanitizeRelayHeaderRecord({
      Authorization: "Bearer th_secret",
      "X-Api-Key": "upstream-secret",
      "Content-Type": "application/json",
      "X-Request-ID": "request-1",
      Cookie: "session=secret",
    }),
    {
      "content-type": "application/json",
      "x-request-id": "request-1",
    },
  );
});

test("usage parsing accepts totals and derives a missing total", () => {
  assert.deepEqual(parseRelayUsage({ prompt_tokens: 2, completion_tokens: 3 }), {
    promptTokens: 2,
    completionTokens: 3,
    totalTokens: 5,
    raw: { prompt_tokens: 2, completion_tokens: 3 },
  });
  assert.equal(parseRelayUsage({ total_tokens: 9 }).totalTokens, 9);
});

test("upstream chat URL preserves provider version paths", () => {
  assert.equal(
    buildRelayUpstreamChatUrl("https://open.bigmodel.cn/api/paas/v4").toString(),
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  );
  assert.equal(
    buildRelayUpstreamChatUrl("https://api.deepseek.com?ignored=1#ignored").toString(),
    "https://api.deepseek.com/chat/completions",
  );
});

test("SSE inspection survives arbitrary UTF-8 and event chunk boundaries", () => {
  const source = [
    'data: {"id":"one","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"你"}}]}\r\n\r\n',
    'data: {"choices":[{"index":0,"delta":{"content":"好","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":"}}]}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  const bytes = new TextEncoder().encode(source);
  const inspector = new SseAuditInspector();
  for (const [start, end] of [[0, 7], [7, 41], [41, 83], [83, 167], [167, bytes.length]]) {
    inspector.feed(bytes.slice(start, end));
  }
  const snapshot = inspector.finish();

  assert.equal(snapshot.doneSeen, true);
  assert.equal(snapshot.malformedEventCount, 0);
  assert.equal(snapshot.usage.totalTokens, 5);
  assert.equal(snapshot.assembled.choices[0]?.message.content, "你好");
  assert.equal(
    snapshot.assembled.choices[0]?.message.tool_calls?.[0]?.function?.arguments,
    '{"q":1}',
  );
});

test("SSE passthrough is byte-transparent and reports completion", async () => {
  const chunks = [
    new TextEncoder().encode('data: {"choices":[]}\n\n'),
    new TextEncoder().encode("data: [DONE]\n\n"),
  ];
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const passthrough = createSsePassthrough(upstream);
  const reader = passthrough.stream.getReader();
  const received: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    received.push(next.value);
  }
  const completion = await passthrough.completion;

  assert.equal(completion.state, "completed");
  assert.equal(completion.audit.doneSeen, true);
  assert.deepEqual(
    received.map((item) => [...item]),
    chunks.map((item) => [...item]),
  );
});
