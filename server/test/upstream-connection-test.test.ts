import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUpstreamTestBody,
  formatUpstreamBusinessFailure,
  parseUpstreamBusinessFailure,
  parseUpstreamModels,
  probeUpstreamModels,
  resolveUpstreamTestModel,
  resolveUpstreamTestProtocol,
  summarizeUpstreamHttpError,
} from "../src/lib/upstream-connection-test.js";

test("HTTP-success GLM error envelopes remain connection failures", () => {
  const failure = parseUpstreamBusinessFailure({
    code: 401,
    msg: "令牌已过期或验证不正确",
    success: false,
  });

  assert.deepEqual(failure, {
    code: "401",
    message: "令牌已过期或验证不正确",
  });
  assert.equal(
    formatUpstreamBusinessFailure(failure!),
    "上游返回业务错误（401）：令牌已过期或验证不正确",
  );
});

test("ordinary successful model payloads are not business failures", () => {
  assert.equal(
    parseUpstreamBusinessFailure({ data: [{ id: "glm-5" }], success: true }),
    null,
  );
  assert.equal(parseUpstreamBusinessFailure({ data: [] }), null);
});

test("upstream model lists keep string ids and drop unknown entries", () => {
  assert.deepEqual(
    parseUpstreamModels({ data: [{ id: "glm-5.3" }, "glm-5.3-flash", { name: "skip" }, 12] }),
    ["glm-5.3", "glm-5.3-flash"],
  );
  assert.deepEqual(parseUpstreamModels({ data: "not-an-array" }), []);
});

test("HTTP error summaries prefer the upstream error message", () => {
  assert.equal(
    summarizeUpstreamHttpError(401, JSON.stringify({ error: { message: "invalid api key" } })),
    "上游返回 HTTP 401：invalid api key",
  );
});

test("test protocol prefers OpenAI Chat when the channel supports it", () => {
  assert.equal(
    resolveUpstreamTestProtocol(["openai_chat", "anthropic_messages"]),
    "openai_chat",
  );
  assert.equal(resolveUpstreamTestProtocol(["openai_chat"], "anthropic_messages"), "openai_chat");
  assert.equal(resolveUpstreamTestProtocol(["openai_chat"], "openai_chat"), "openai_chat");
  assert.throws(
    () => resolveUpstreamTestProtocol(["anthropic_messages"], "openai_chat"),
    /未声明支持所选协议/,
  );
  assert.throws(() => resolveUpstreamTestProtocol([]), /未声明任何支持协议/);
});

test("unsaved credential probe sends a real chat completion", async () => {
  const secret = "sk-employee-test-key";
  let requested: { url: string; authorization: string | null; body: unknown } | null = null;
  const result = await probeUpstreamModels({
    providerCode: "glm",
    protocol: "openai_chat",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    authStyle: "bearer",
    secret,
    now: new Date("2026-09-10T04:00:00.000Z"),
    fetchImpl: async (url, init) => {
      requested = {
        url: String(url),
        authorization: new Headers(init?.headers).get("Authorization"),
        body: JSON.parse(String(init?.body ?? "{}")),
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
      });
    },
  });
  assert.equal(requested?.authorization, `Bearer ${secret}`);
  assert.match(requested?.url ?? "", /\/chat\/completions$/);
  assert.deepEqual(requested?.body, buildUpstreamTestBody("openai_chat", "glm-5.3"));
  assert.deepEqual(result, {
    ok: true,
    testedAt: "2026-09-10T04:00:00.000Z",
    latencyMs: result.latencyMs,
    httpStatus: 200,
    modelCount: 1,
    models: ["glm-5.3"],
    message: "推理成功（openai_chat / glm-5.3）",
    protocol: "openai_chat",
    rawBody: JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
  });
  assert.equal(result.latencyMs >= 0, true);
});

test("credential probe treats weekly usage-cap 429 as a failed inference", async () => {
  const result = await probeUpstreamModels({
    providerCode: "glm",
    protocol: "openai_chat",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    authStyle: "bearer",
    secret: "sk-weekly-cap",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "1310",
            message: "已达到 7 天使用上限，2026-09-21 17:49:49 后可继续使用。",
          },
        }),
        { status: 429 },
      ),
  });
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 429);
  assert.match(result.message, /7 天使用上限/);
});

test("resolveUpstreamTestModel prefers discovered models then provider defaults", () => {
  assert.equal(resolveUpstreamTestModel("glm", [" glm-4.6 ", "glm-5.3"]), "glm-4.6");
  assert.equal(resolveUpstreamTestModel("glm"), "glm-5.3");
  assert.equal(resolveUpstreamTestModel("deepseek"), "deepseek-chat");
  assert.throws(() => resolveUpstreamTestModel("haizhi"), /无法确定测试模型/);
});

test("unsaved credential probe treats HTTP-success business envelopes as failures", async () => {
  const result = await probeUpstreamModels({
    providerCode: "glm",
    protocol: "openai_chat",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    authStyle: "bearer",
    secret: "sk-expired",
    now: new Date("2026-09-10T04:00:00.000Z"),
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ success: false, code: 401, msg: "令牌已过期或验证不正确" }),
        { status: 200 },
      ),
  });
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 200);
  assert.match(result.message, /令牌已过期或验证不正确/);
  assert.deepEqual(result.models, []);
});

test("unsaved credential probe rejects unofficial template hosts", async () => {
  await assert.rejects(
    () =>
      probeUpstreamModels({
        providerCode: "glm",
        protocol: "openai_chat",
        baseUrl: "https://gateway.example.test/v1",
        authStyle: "bearer",
        secret: "sk-employee-test-key",
      }),
    /已确认供应商的官方 HTTPS 地址/,
  );
});

test("admin connection test never clears or shortens a live relay cooldown", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(resolve(root, "src/routes/admin/credentials.ts"), "utf8");
  // 失败路径只延长不缩短（对齐 relay coolCredential 的 greatest）
  assert.match(
    source,
    /greatest\(\s*coalesce\(\$\{upstreamCredentials\.coolUntil\}, \$\{failedCoolUntilIso\}::timestamptz\),\s*\$\{failedCoolUntilIso\}::timestamptz\s*\)/,
  );
  // 成功路径仅在冷却已到期时解除（对齐 relay markCredentialSuccess 的条件）
  assert.match(
    source,
    /when \$\{upstreamCredentials\.status\} = 'cooling' and \$\{cooldownExpired\}\s*then null/,
  );
  assert.match(
    source,
    /when \$\{upstreamCredentials\.status\} = 'cooling' and \$\{cooldownExpired\}\s*then 'active'::credential_status/,
  );
});
