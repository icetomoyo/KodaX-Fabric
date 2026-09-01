import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import type { RelayCandidate, RelayPrincipal } from "../src/lib/relay/types.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  assertSafeRequestId,
  buildRequestContextRecord,
  findRequestContextFile,
  publicCandidate,
  redactHeaders,
  requestContextFilePath,
  sanitizeContextValue,
  serializeRequestContext,
  writeRequestContextFile,
} = await import("../src/lib/relay/request-context.js");

const principal: RelayPrincipal = {
  employeeId: 7,
  employeeApiKeyId: 11,
  teamId: 4,
  protocol: "openai_chat",
  productLineId: 1,
  employeeName: "张闯",
  employeePhone: "13800000000",
  employeeDept: "平台",
};

const candidate: RelayCandidate = {
  routeId: 1,
  routePriority: 0,
  routeWeight: 100,
  clientModel: "glm-5.3",
  upstreamModel: "glm-5.3",
  providerCode: "glm",
  authStyle: "bearer",
  supportedProtocols: ["openai_chat"],
  upstreamProtocol: "openai_chat",
  productLineId: 1,
  productType: "coding_plan",
  retryPolicy: null,
  credentialId: 9,
  credentialSuffix: "Ab12",
  secretEncrypted: "should-never-appear",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  credentialPriority: 0,
  credentialWeight: 100,
};

test("request context path is day/requestId.json.gz", () => {
  assert.equal(
    requestContextFilePath("/var/lib/tokenhub/request-context", "2026-09-01", "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    "/var/lib/tokenhub/request-context/2026-09-01/threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json.gz",
  );
});

test("unsafe request ids are rejected", () => {
  assert.throws(() => assertSafeRequestId("../etc/passwd"));
  assert.throws(() => requestContextFilePath("/tmp", "2026-09-01", "a/b"));
  assert.throws(() => requestContextFilePath("/tmp", "not-a-day", "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
});

test("authorization headers are redacted", () => {
  assert.deepEqual(
    redactHeaders({
      authorization: "Bearer sk-live-secret",
      "x-api-key": "abc",
      "user-agent": "claude-code",
    }),
    {
      authorization: "[redacted]",
      "x-api-key": "[redacted]",
      "user-agent": "claude-code",
    },
  );
});

test("secrets in JSON bodies are redacted, messages stay", () => {
  const sanitized = sanitizeContextValue({
    model: "glm-5.3",
    api_key: "sk-secret",
    secretEncrypted: "cipher",
    messages: [{ role: "user", content: "重构登录" }],
  }) as Record<string, unknown>;
  assert.equal(sanitized.api_key, "[redacted]");
  assert.equal(sanitized.secretEncrypted, "[redacted]");
  assert.deepEqual(sanitized.messages, [{ role: "user", content: "重构登录" }]);
});

test("candidate snapshot never includes the encrypted secret", () => {
  const published = publicCandidate(candidate);
  assert.equal(published?.credentialSuffix, "Ab12");
  assert.equal(JSON.stringify(published).includes("should-never-appear"), false);
});

test("envelope keeps request messages and strips employee phone", () => {
  const record = buildRequestContextRecord({
    requestId: "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    startedAt: new Date("2026-09-01T04:00:00.000Z"),
    endedAt: new Date("2026-09-01T04:00:01.500Z"),
    principal,
    clientModel: "glm-5.3",
    candidate,
    status: "success",
    httpStatus: 200,
    usage: {
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
      cacheReadTokens: 0,
      raw: { prompt_tokens: 10 },
    },
    context: {
      path: "/v1/chat/completions",
      stream: false,
      headers: { authorization: "Bearer vk-secret", "user-agent": "cursor" },
      requestBody: { model: "glm-5.3", messages: [{ role: "user", content: "hello" }] },
      retryTrace: [
        {
          attempt: 1,
          providerCode: "glm",
          productLineId: 1,
          credentialId: 9,
          credentialSuffix: "Ab12",
          status: 200,
          latencyMs: 120,
          outcome: "success",
        },
      ],
      responseBody: { choices: [{ message: { content: "ok" } }] },
    },
  });
  assert.equal(record.latencyMs, 1500);
  assert.equal(record.headers.authorization, "[redacted]");
  assert.deepEqual(record.requestBody, {
    model: "glm-5.3",
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal("employeePhone" in record.principal, false);
  assert.equal(JSON.stringify(record).includes("should-never-appear"), false);
  assert.equal(JSON.stringify(record).includes("vk-secret"), false);
});

test("oversized envelopes drop bodies instead of overflowing the cap", () => {
  const record = buildRequestContextRecord({
    requestId: "threq_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    startedAt: new Date("2026-09-01T04:00:00.000Z"),
    principal,
    clientModel: "glm-5.3",
    status: "success",
    context: {
      path: "/v1/chat/completions",
      stream: false,
      headers: {},
      requestBody: { blob: "x".repeat(5000) },
      retryTrace: [],
      responseBody: { blob: "y".repeat(5000) },
    },
  });
  const { json, truncated } = serializeRequestContext(record, 2_000);
  assert.equal(truncated, true);
  const parsed = JSON.parse(json) as { truncated: boolean; requestBody: { omitted?: string } };
  assert.equal(parsed.truncated, true);
  assert.ok(parsed.requestBody.omitted);
  assert.ok(Buffer.byteLength(json) <= 2_000);
});

test("writeRequestContextFile gzip-roundtrips under the quota day", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-"));
  const record = buildRequestContextRecord({
    requestId: "threq_cccccccccccccccccccccccccccccccc",
    startedAt: new Date("2026-09-01T04:00:00.000Z"),
    principal,
    clientModel: "glm-5.3",
    candidate,
    status: "success",
    context: {
      path: "/v1/messages",
      stream: true,
      headers: { "anthropic-version": "2023-06-01" },
      requestBody: { model: "glm-5.3", messages: [{ role: "user", content: "hi" }] },
      retryTrace: [],
      streamAudit: {
        truncated: false,
        eventCount: 3,
        assembled: { protocol: "anthropic_messages", message: { content: [{ type: "text", text: "hi" }] } },
      },
    },
  });
  const path = await writeRequestContextFile({
    rootDir: root,
    timeZone: "Asia/Shanghai",
    maxBytes: 1_000_000,
    record,
  });
  assert.equal(path, join(root, "2026-09-01", "threq_cccccccccccccccccccccccccccccccc.json.gz"));
  const unzipped = gunzipSync(await readFile(path)).toString("utf8");
  const parsed = JSON.parse(unzipped) as { requestBody: { messages: unknown[] }; streamAudit: { eventCount: number } };
  assert.equal(parsed.streamAudit.eventCount, 3);
  assert.equal(parsed.requestBody.messages.length, 1);
});

test("findRequestContextFile locates the gzip by quota day", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-find-"));
  const startedAt = new Date("2026-09-01T04:00:00.000Z");
  const record = buildRequestContextRecord({
    requestId: "threq_dddddddddddddddddddddddddddddddd",
    startedAt,
    principal,
    clientModel: "glm-5.3",
    status: "success",
    context: {
      path: "/v1/chat/completions",
      stream: false,
      headers: {},
      requestBody: { model: "glm-5.3" },
      retryTrace: [],
      responseBody: { ok: true },
    },
  });
  const written = await writeRequestContextFile({
    rootDir: root,
    timeZone: "Asia/Shanghai",
    maxBytes: 1_000_000,
    record,
  });
  assert.equal(
    await findRequestContextFile(root, "Asia/Shanghai", record.requestId, startedAt),
    written,
  );
  assert.equal(
    await findRequestContextFile(
      root,
      "Asia/Shanghai",
      "threq_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      startedAt,
    ),
    null,
  );
});
