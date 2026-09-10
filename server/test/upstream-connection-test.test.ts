import assert from "node:assert/strict";
import test from "node:test";
import {
  formatUpstreamBusinessFailure,
  parseUpstreamBusinessFailure,
  parseUpstreamModels,
  probeUpstreamModels,
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

test("test protocol prefers Anthropic when the channel supports it", () => {
  assert.equal(
    resolveUpstreamTestProtocol(["openai_chat", "anthropic_messages"]),
    "anthropic_messages",
  );
  assert.equal(resolveUpstreamTestProtocol(["openai_chat"], "openai_chat"), "openai_chat");
  assert.throws(
    () => resolveUpstreamTestProtocol(["openai_chat"], "anthropic_messages"),
    /未声明支持所选协议/,
  );
  assert.throws(() => resolveUpstreamTestProtocol([]), /未声明任何支持协议/);
});

test("unsaved credential probe reports success without persisting", async () => {
  const secret = "sk-employee-test-key";
  let requested: { url: string; authorization: string | null } | null = null;
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
      };
      return new Response(JSON.stringify({ data: [{ id: "glm-5.3" }] }), { status: 200 });
    },
  });
  assert.equal(requested?.authorization, `Bearer ${secret}`);
  assert.match(requested?.url ?? "", /\/models$/);
  assert.deepEqual(result, {
    ok: true,
    testedAt: "2026-09-10T04:00:00.000Z",
    latencyMs: result.latencyMs,
    httpStatus: 200,
    modelCount: 1,
    models: ["glm-5.3"],
    message: "连接成功（openai_chat），发现 1 个模型",
    protocol: "openai_chat",
  });
  assert.equal(result.latencyMs >= 0, true);
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
  assert.equal(result.message, "上游返回业务错误（401）：令牌已过期或验证不正确");
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
