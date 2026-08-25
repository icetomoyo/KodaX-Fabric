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
  quotaMonthStartDay,
  zonedDateRange,
  zonedMonthRange,
} = await import("../src/lib/quota-time.js");
const {
  appendOtherBucket,
  fillDailyUsage,
  summarizeDailyUsage,
} = await import("../src/lib/user-usage.js");
const { extractBusinessAuditBodies, normalizeAuditContext } = await import("../src/lib/audit-context.js");
const { generateEnterpriseCode, ENTERPRISE_CODE_PATTERN } = await import("../src/lib/enterprise.js");
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

test("quota month starts at QUOTA_TIMEZONE local midnight on the first", () => {
  assert.equal(quotaMonthStartDay(new Date("2026-08-31T15:59:59.999Z"), "Asia/Shanghai"), "2026-08-01");
  assert.equal(quotaMonthStartDay(new Date("2026-08-31T16:00:00.000Z"), "Asia/Shanghai"), "2026-09-01");
  const august = zonedMonthRange(new Date("2026-08-15T08:00:00.000Z"), "Asia/Shanghai");
  assert.equal(august.from, "2026-08-01");
  assert.equal(august.to, "2026-08-31");
  assert.equal(august.start.toISOString(), "2026-07-31T16:00:00.000Z");
  assert.equal(august.endExclusive.toISOString(), "2026-08-31T16:00:00.000Z");
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

test("enterprise codes are E plus eight unambiguous characters", () => {
  const code = generateEnterpriseCode(() => 0);
  assert.equal(code.length, 9);
  assert.match(code, ENTERPRISE_CODE_PATTERN);
  assert.equal(generateEnterpriseCode(() => 1) !== code, true);
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

test("business audit bodies keep conversation turns and drop system prompts, tools, and media", () => {
  const extracted = extractBusinessAuditBodies({
    requestBody: {
      model: "glm-4",
      stream: true,
      system: "you are a long product prompt",
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
      mcp_servers: [{ url: "https://mcp.example.test", authorization_token: "mcp-secret" }],
      messages: [
        { role: "system", content: "hidden system prompt" },
        { role: "developer", content: "hidden developer prompt" },
        {
          role: "user",
          content: [
            { type: "text", text: "看这张图" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          ],
        },
        {
          role: "assistant",
          content: "调用工具",
          tool_calls: [{ id: "call-1", type: "function", function: { name: "lookup", arguments: "{\"q\":\"hi\"}" } }],
        },
      ],
    },
    responseBody: {
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: "done", reasoning_content: "long hidden chain" },
      }],
      usage: { prompt_tokens: 9, completion_tokens: 1 },
    },
  });

  const serialized = JSON.stringify(extracted);
  assert.equal(serialized.includes("hidden system prompt"), false);
  assert.equal(serialized.includes("hidden developer prompt"), false);
  assert.equal(serialized.includes("long product prompt"), false);
  assert.equal(serialized.includes("mcp-secret"), false);
  assert.equal(serialized.includes("AAAA"), false);
  assert.equal(serialized.includes("lookup"), true);
  assert.equal(serialized.includes("看这张图"), true);
  assert.equal(serialized.includes("done"), true);
  assert.deepEqual(extracted.requestBody, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "看这张图" },
          { type: "image_url", omitted: true },
        ],
      },
      {
        role: "assistant",
        content: "调用工具",
        tool_calls: [{ id: "call-1", type: "function", name: "lookup", arguments: "{\"q\":\"hi\"}" }],
      },
    ],
  });
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
