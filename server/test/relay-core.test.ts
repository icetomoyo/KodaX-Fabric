import assert from "node:assert/strict";
import test from "node:test";
import type { RelayCandidate } from "../src/lib/relay/types.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { parseRelayUsage, sanitizeRelayAuditBody, sanitizeRelayHeaderRecord } = await import(
  "../src/lib/relay/audit.js"
);
const { credentialSupportsProtocol, orderRelayCandidates } = await import(
  "../src/lib/relay/routing.js"
);
const { SseAuditInspector, createSsePassthrough } = await import(
  "../src/lib/relay/sse.js"
);
const {
  buildRelayUpstreamChatUrl,
  buildRelayUpstreamHeaders,
  buildRelayUpstreamUrl,
  sanitizeRelayUpstreamForwardHeaders,
} = await import("../src/lib/relay/upstream.js");
const { extractAnyRelayApiKey, extractRelayApiKey } = await import(
  "../src/middleware/api-key.js"
);
const { getProviderTemplate, PROVIDER_TEMPLATES } = await import(
  "../src/lib/provider-templates.js"
);

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
    supportedProtocols: ["openai_chat"],
    upstreamProtocol: "openai_chat",
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

test("upstream channel templates do not expose Anthropic as a provider option", () => {
  assert.equal(getProviderTemplate("anthropic"), undefined);
  assert.equal(PROVIDER_TEMPLATES.some((template) => template.code === "anthropic"), false);
});

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

test("audit bodies redact embedded MCP credentials without changing token fields", () => {
  const source = {
    max_tokens: 128,
    tools: [
      {
        type: "mcp",
        headers: { Authorization: "Bearer third-party", "x-safe": "not persisted" },
      },
    ],
    mcp_servers: [
      { url: "https://mcp.example.test", authorization_token: "mcp-secret" },
    ],
    nested: { client_secret: "oauth-secret", content: "keep me" },
  };
  const sanitized = sanitizeRelayAuditBody(source) as Record<string, unknown>;
  const serialized = JSON.stringify(sanitized);
  assert.equal(serialized.includes("third-party"), false);
  assert.equal(serialized.includes("mcp-secret"), false);
  assert.equal(serialized.includes("oauth-secret"), false);
  assert.equal(sanitized.max_tokens, 128);
  assert.match(serialized, /keep me/);
  assert.equal(source.mcp_servers[0].authorization_token, "mcp-secret");
});

test("usage parsing accepts totals and derives a missing total", () => {
  assert.deepEqual(parseRelayUsage({ prompt_tokens: 2, completion_tokens: 3 }), {
    promptTokens: 2,
    completionTokens: 3,
    totalTokens: 5,
    raw: { prompt_tokens: 2, completion_tokens: 3 },
  });
  assert.equal(parseRelayUsage({ total_tokens: 9 }).totalTokens, 9);
  assert.deepEqual(parseRelayUsage({ input_tokens: 4, output_tokens: 6 }), {
    promptTokens: 4,
    completionTokens: 6,
    totalTokens: 10,
    raw: { input_tokens: 4, output_tokens: 6 },
  });
  assert.deepEqual(
    parseRelayUsage({
      input_tokens: 4,
      cache_creation_input_tokens: 3,
      cache_read_input_tokens: 5,
      output_tokens: 6,
    }),
    {
      promptTokens: 12,
      completionTokens: 6,
      totalTokens: 18,
      raw: {
        input_tokens: 4,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 5,
        output_tokens: 6,
      },
    },
  );
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

test("protocol operation URLs preserve base paths and avoid duplicate Anthropic v1", () => {
  assert.equal(
    buildRelayUpstreamUrl(
      "https://api.openai.com/v1",
      "openai_responses",
      "responses_compact",
    ).toString(),
    "https://api.openai.com/v1/responses/compact",
  );
  assert.equal(
    buildRelayUpstreamUrl("https://api.anthropic.com", "anthropic_messages", "messages")
      .toString(),
    "https://api.anthropic.com/v1/messages",
  );
  assert.equal(
    buildRelayUpstreamUrl("https://gateway.test/v1", "anthropic_messages", "messages")
      .toString(),
    "https://gateway.test/v1/messages",
  );
  assert.throws(() =>
    buildRelayUpstreamUrl("https://example.test/v1", "openai_chat", "responses")
  );
});

test("upstream protocol headers use credential auth and forward only safe metadata", () => {
  assert.deepEqual(
    sanitizeRelayUpstreamForwardHeaders("anthropic_messages", {
      authorization: "Bearer client-secret",
      "x-api-key": "client-secret",
      host: "attacker.test",
      "content-length": "999",
      "anthropic-version": "2024-01-01",
      "anthropic-beta": "tools-2024-04-04",
    }),
    {
      "anthropic-version": "2024-01-01",
      "anthropic-beta": "tools-2024-04-04",
    },
  );

  const headers = buildRelayUpstreamHeaders({
    protocol: "anthropic_messages",
    authStyle: "x-api-key",
    secret: "upstream-secret",
    forwardHeaders: { "anthropic-beta": "feature-a" },
    requestId: "request-1",
  });
  assert.equal(headers.get("x-api-key"), "upstream-secret");
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("anthropic-version"), "2023-06-01");
  assert.equal(headers.get("anthropic-beta"), "feature-a");
  assert.equal(headers.get("x-request-id"), "request-1");
});

test("protocol filtering defaults legacy credentials to Chat Completions", () => {
  assert.equal(credentialSupportsProtocol({}, "openai_chat"), true);
  assert.equal(credentialSupportsProtocol({}, "anthropic_messages"), false);
  assert.equal(
    credentialSupportsProtocol(
      { supportedProtocols: ["openai_chat", "openai_responses"] },
      "openai_responses",
    ),
    true,
  );
});

test("protocol API-key extraction accepts Anthropic aliases and rejects conflicts", () => {
  assert.deepEqual(
    extractRelayApiKey({ "x-api-key": "th_anthropic" }, "anthropic_messages"),
    { ok: true, key: "th_anthropic" },
  );
  assert.deepEqual(
    extractRelayApiKey(
      { authorization: "Bearer th_same", "x-api-key": "th_same" },
      "anthropic_messages",
    ),
    { ok: true, key: "th_same" },
  );
  assert.deepEqual(
    extractRelayApiKey(
      { authorization: "Bearer th_one", "x-api-key": "th_two" },
      "anthropic_messages",
    ),
    { ok: false, reason: "conflict" },
  );
  assert.deepEqual(
    extractRelayApiKey({ "x-api-key": "th_only" }, "openai_responses"),
    { ok: false, reason: "missing" },
  );
  assert.deepEqual(extractAnyRelayApiKey({ "x-api-key": "th_models" }), {
    ok: true,
    key: "th_models",
  });
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
