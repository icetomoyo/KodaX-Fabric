import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyReply, FastifyRequest } from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const {
  nextQuotaResetAt,
  quotaDayAt,
  zonedDateRange,
} = await import("../src/lib/quota-time.js");
const {
  appendOtherBucket,
  fillDailyUsage,
  summarizeDailyUsage,
} = await import("../src/lib/user-usage.js");
const { normalizeAuditContext } = await import("../src/lib/audit-context.js");
const { assertDailyTokenLimit, RelayLimitError } = await import(
  "../src/lib/relay/quota.js"
);
const {
  generateEnterpriseCode,
  membershipDailyTokenLimit,
  ENTERPRISE_CODE_PATTERN,
} = await import("../src/lib/enterprise.js");
const { contextAuditDedupSince, requireAdminLogContext } = await import(
  "../src/routes/admin/logs.js"
);

test("quota day changes exactly at QUOTA_TIMEZONE midnight", () => {
  assert.equal(quotaDayAt(new Date("2026-08-05T15:59:59.999Z"), "Asia/Shanghai"), "2026-08-05");
  assert.equal(quotaDayAt(new Date("2026-08-05T16:00:00.000Z"), "Asia/Shanghai"), "2026-08-06");
  assert.equal(
    nextQuotaResetAt(new Date("2026-08-05T08:00:00.000Z"), "Asia/Shanghai"),
    "2026-08-06T00:00:00+08:00",
  );
});

test("timezone date ranges use local closed days and survive DST", () => {
  const shanghai = zonedDateRange("2026-08-05", "2026-08-05", "Asia/Shanghai");
  assert.equal(shanghai.start.toISOString(), "2026-08-04T16:00:00.000Z");
  assert.equal(shanghai.endExclusive.toISOString(), "2026-08-05T16:00:00.000Z");

  const newYorkDst = zonedDateRange("2026-03-08", "2026-03-08", "America/New_York");
  assert.equal(
    newYorkDst.endExclusive.getTime() - newYorkDst.start.getTime(),
    23 * 60 * 60 * 1_000,
  );
});

test("personal accounts without an enterprise have zero Token quota", () => {
  assert.equal(membershipDailyTokenLimit(null, 500_000_000), 0);
  assert.equal(membershipDailyTokenLimit(undefined, 500_000_000), 0);
  assert.equal(membershipDailyTokenLimit(12, 500_000_000), 500_000_000);
});

test("enterprise codes are E plus eight unambiguous characters", () => {
  const code = generateEnterpriseCode(() => 0);
  assert.equal(code.length, 9);
  assert.match(code, ENTERPRISE_CODE_PATTERN);
  assert.equal(generateEnterpriseCode(() => 1) !== code, true);
});

test("daily hard Token limit treats zero as a valid deny-all limit", () => {
  assert.throws(() => assertDailyTokenLimit(0, 0), (error) => (
    error instanceof RelayLimitError && error.code === "daily_token_limit_exceeded"
  ));
  assert.doesNotThrow(() => assertDailyTokenLimit(99, 100));
  assert.throws(() => assertDailyTokenLimit(100, 100));
});

test("daily usage is zero-filled and summary remains strongly consistent", () => {
  const daily = fillDailyUsage("2026-08-01", "2026-08-03", [{
    day: "2026-08-02",
    promptTokens: 7,
    completionTokens: 3,
    totalTokens: 10,
    requestCount: 2,
    errorCount: 1,
  }]);
  const summary = summarizeDailyUsage(daily);
  assert.deepEqual(daily.map((row) => row.day), ["2026-08-01", "2026-08-02", "2026-08-03"]);
  assert.equal(daily[0].successRate, null);
  assert.equal(summary.totalTokens, daily.reduce((sum, row) => sum + row.totalTokens, 0));
  assert.equal(summary.requestCount, daily.reduce((sum, row) => sum + row.requestCount, 0));
  assert.equal(summary.errorCount, daily.reduce((sum, row) => sum + row.errorCount, 0));
  assert.equal(summary.successRate, 0.5);
});

test("usage breakdown keeps Top N shape and folds the remainder into other", () => {
  assert.deepEqual(
    appendOtherBucket(
      [{ key: "provider-a", totalTokens: 80, requestCount: 8 }],
      { totalTokens: 100, requestCount: 10 },
    ),
    [
      { key: "provider-a", totalTokens: 80, requestCount: 8 },
      { key: "other", totalTokens: 20, requestCount: 2 },
    ],
  );
});

test("context normalization handles Chat and Anthropic without headers or secrets", () => {
  const chat = normalizeAuditContext({
    requestId: "req-chat",
    protocol: "openai_chat",
    clientModel: "client",
    upstreamModel: "upstream",
    requestBody: {
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      tools: [{ type: "function", function: { name: "lookup" } }],
      headers: { Authorization: "Bearer hidden" },
      api_key: "hidden-key",
    },
    responseBody: {
      choices: [{ index: 0, message: { role: "assistant", content: "hi", tool_calls: [{ id: "call-1" }] } }],
    },
    requestBodySize: 100,
    responseBodySize: 80,
    truncated: false,
  });
  assert.equal(chat.tabs.userPrompt.messages.length, 1);
  assert.equal(chat.tabs.skills.tools.length, 1);
  assert.equal(chat.tabs.skills.toolCalls.length, 1);
  assert.equal(JSON.stringify(chat).includes("hidden"), false);
  assert.equal(JSON.stringify(chat).toLowerCase().includes("authorization"), false);
  assert.equal(JSON.stringify(chat).toLowerCase().includes("headers"), false);

  const anthropic = normalizeAuditContext({
    requestId: "req-anthropic",
    protocol: "anthropic_messages",
    clientModel: "claude",
    upstreamModel: "claude-upstream",
    requestBody: { messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] },
    responseBody: { content: [{ type: "text", text: "hi" }] },
    requestBodySize: 12,
    responseBodySize: 14,
    truncated: true,
  });
  assert.equal(anthropic.truncated, true);
  assert.equal(anthropic.tabs.response.content.length, 1);

  const truncated = normalizeAuditContext({
    requestId: "req-truncated",
    protocol: "openai_chat",
    clientModel: "model",
    upstreamModel: null,
    requestBody: {
      truncated: true,
      originalBytes: 999999,
      preview: '{"headers":{"Authorization":"[REDACTED]"',
    },
    responseBody: null,
    requestBodySize: 999999,
    responseBodySize: 0,
    truncated: true,
  });
  const truncatedSerialized = JSON.stringify(truncated).toLowerCase();
  assert.equal(truncatedSerialized.includes("authorization"), false);
  assert.equal(truncatedSerialized.includes("headers"), false);
});

test("admin log context guard rejects employees and uses a five-minute audit window", async () => {
  let statusCode = 200;
  let payload: unknown;
  const reply = {
    code(code: number) {
      statusCode = code;
      return this;
    },
    send(value: unknown) {
      payload = value;
      return value;
    },
  } as unknown as FastifyReply;
  await requireAdminLogContext(
    { session: { role: "employee" } } as unknown as FastifyRequest,
    reply,
  );
  assert.equal(statusCode, 403);
  assert.deepEqual(payload, { success: false, message: "权限不足" });

  const now = new Date("2026-08-06T12:00:00.000Z");
  assert.equal(contextAuditDedupSince(now).toISOString(), "2026-08-06T11:55:00.000Z");
});
