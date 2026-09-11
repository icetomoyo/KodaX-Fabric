import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { env } = await import("../src/config.js");
const {
  formatAccountContext,
  isBareSuperAdmin,
  buildPublicRelayBaseUrl,
  publicSiteOrigin,
  truncateErrorMessage,
} = await import("../src/lib/support-bot/account-context.js");
const {
  createMemorySupportChatStore,
  parseSupportChatMessage,
  runSupportChatTurn,
} = await import("../src/lib/support-bot/chat.js");
const { SupportBotError } = await import("../src/lib/support-bot/errors.js");
const {
  extractSupportRequestId,
  formatRequestLookup,
} = await import("../src/lib/support-bot/lookup-request.js");
const {
  buildSupportLlmMessages,
  hasSupportBotOverride,
  joinChatCompletionsUrl,
  parseSupportCompletion,
  readAssistantContent,
} = await import("../src/lib/support-bot/invoke.js");
const {
  SUPPORT_BOT_KNOWLEDGE,
  applySupportOriginPlaceholders,
  buildSupportAgentSystemPrompt,
} = await import("../src/lib/support-bot/knowledge.js");
const { supportBotRateLimitKey } = await import("../src/lib/support-bot/rate-limit.js");
const { supportRoutes, supportBotRuntime } = await import("../src/routes/support.js");

const employeeSession = {
  sub: "41",
  role: "employee" as const,
  phone: "13800000041",
  name: "BotUser",
  mustChangePassword: false,
  enterpriseId: 8,
};

function attachSession(
  session: typeof employeeSession & { trueRole?: typeof employeeSession.role | "admin" },
) {
  return async (req: { session?: typeof session; employeeId?: number }) => {
    req.session = session;
    req.employeeId = Number(session.sub);
  };
}

test("knowledge covers GuideView facts and refuses invented features", () => {
  assert.match(SUPPORT_BOT_KNOWLEDGE, /th_\.\.\./);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /\/ai\/v1\/messages/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /\/ai\/chat\/completions/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /\/ai\/responses/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /:3000/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /127\.0\.0\.1:15721/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /team_required/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /工单系统已删除/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /飞书 Bot/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /不要要求用户粘贴完整 API Key/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /ZCode/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /勾选「图片」/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /zcode-add-provider\.png/);
  assert.match(SUPPORT_BOT_KNOWLEDGE, /zcode-add-model\.png/);
  const prompt = buildSupportAgentSystemPrompt("https://tokenhub.haizhi.com/ai");
  assert.match(prompt, /https:\/\/tokenhub\.haizhi\.com\/ai/);
  assert.match(prompt, /https:\/\/tokenhub\.haizhi\.com\/guides\/zcode-add-provider\.png/);
  assert.match(prompt, /https:\/\/tokenhub\.haizhi\.com\/guides\/zcode-add-model\.png/);
  assert.equal(
    existsSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../web/public/guides/zcode-add-provider.png")),
    true,
  );
  assert.equal(
    existsSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../web/public/guides/zcode-add-model.png")),
    true,
  );
  assert.match(prompt, /lookup_my_account/);
  assert.match(prompt, /lookup_request/);
  assert.match(prompt, /lookup_invite_contacts/);
  assert.match(prompt, /不要编造/);
  assert.match(prompt, /不要写 \{origin\}/);
  assert.doesNotMatch(prompt, /retrieve_docs/);
});

test("Base URL answers use the request origin, not the {origin} template", () => {
  assert.equal(publicSiteOrigin("https://tokenhub.haizhi.com/ai"), "https://tokenhub.haizhi.com");
  assert.equal(publicSiteOrigin("https://tokenhub.haizhi.com/ai/"), "https://tokenhub.haizhi.com");
  const filled = applySupportOriginPlaceholders(
    "Base URL 一律是当前站点的 `{origin}/ai`。",
    "https://tokenhub.haizhi.com",
  );
  assert.equal(filled, "Base URL 一律是当前站点的 `https://tokenhub.haizhi.com/ai`。");
  assert.doesNotMatch(filled, /\{origin\}/);
});

test("joins chat completions URL without doubling the path", () => {
  assert.equal(
    joinChatCompletionsUrl("https://api.example.com/v1"),
    "https://api.example.com/v1/chat/completions",
  );
  assert.equal(
    joinChatCompletionsUrl("https://api.example.com/v1/"),
    "https://api.example.com/v1/chat/completions",
  );
  assert.equal(
    joinChatCompletionsUrl("https://api.example.com/v1/chat/completions"),
    "https://api.example.com/v1/chat/completions",
  );
  assert.equal(
    joinChatCompletionsUrl("https://open.bigmodel.cn/api/paas/v4"),
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  );
  assert.equal(
    joinChatCompletionsUrl("https://open.bigmodel.cn/api/coding/paas/v4"),
    "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
  );
});

test("override transport is ready when only the API key is set", () => {
  assert.equal(hasSupportBotOverride("sk-bot"), true);
  assert.equal(hasSupportBotOverride(undefined), false);
  assert.equal(hasSupportBotOverride(""), false);
});

test("rate-limit key is scoped to the acting employee", () => {
  assert.equal(supportBotRateLimitKey(41), "support_bot:rl:41");
});

test("parses chat message length and public relay base URL", () => {
  assert.equal(parseSupportChatMessage("  hi  "), "hi");
  assert.equal(parseSupportChatMessage(""), null);
  assert.equal(parseSupportChatMessage("   "), null);
  assert.equal(parseSupportChatMessage("x".repeat(2001)), null);
  assert.equal(parseSupportChatMessage("x".repeat(2000)), "x".repeat(2000));
  assert.equal(
    buildPublicRelayBaseUrl({ protocol: "https", host: "tokenhub.example.com" }),
    "https://tokenhub.example.com/ai",
  );
  assert.equal(truncateErrorMessage("a".repeat(400)), "a".repeat(400));
  assert.equal(truncateErrorMessage("a".repeat(401))?.length, 401);
  assert.ok(truncateErrorMessage("a".repeat(401))?.endsWith("…"));
});

test("account context hides other orgs for a bare super admin", () => {
  assert.equal(isBareSuperAdmin({ role: "admin" }), true);
  assert.equal(isBareSuperAdmin({ role: "org_admin", trueRole: "admin" }), true);
  assert.equal(
    isBareSuperAdmin({ role: "employee", trueRole: "admin", actAs: { role: "employee" } }),
    false,
  );
  const text = formatAccountContext({
    role: "admin",
    bareAdmin: true,
    enterpriseName: "ShouldNotLeak",
    teamName: "SecretTeam",
    hasTeam: true,
    keys: [],
    recentCalls: [],
    modelsByChannel: [],
    relayBaseUrl: "https://tokenhub.example.com/ai",
  });
  assert.match(text, /角色：admin/);
  assert.doesNotMatch(text, /ShouldNotLeak/);
  assert.doesNotMatch(text, /SecretTeam/);
});

test("account context lists keys, joined errors, and missing team", () => {
  const text = formatAccountContext({
    role: "employee",
    bareAdmin: false,
    enterpriseName: "海致",
    teamName: null,
    hasTeam: false,
    keys: [
      {
        id: 9,
        name: "cursor",
        keyPrefix: "th_abcd",
        protocol: "openai_chat",
        status: "active",
        teamName: "平台组",
        lastUsedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    recentCalls: [
      {
        requestId: "req_1",
        status: "upstream_error",
        clientModel: "glm-5.3-flash",
        createdAt: "2026-09-01T01:00:00.000Z",
        errorCode: "upstream_timeout",
        errorMessage: "上游请求超时",
      },
    ],
    modelsByChannel: [{ channel: "智谱", models: ["glm-5.3", "glm-5.3-flash"] }],
    relayBaseUrl: "https://tokenhub.example.com/ai",
  });
  assert.match(text, /没有团队/);
  assert.match(text, /th_abcd/);
  assert.doesNotMatch(text, /keyHash|keyEncrypted|th_[A-Za-z0-9]{20,}/);
  assert.match(text, /req_1/);
  assert.match(text, /upstream_timeout/);
  assert.match(text, /glm-5.3-flash/);
});

test("empty assistant content is treated as upstream failure", () => {
  assert.equal(readAssistantContent({ choices: [{ message: { content: "  ok  " } }] }), "ok");
  assert.equal(readAssistantContent({ choices: [{ message: { content: "   " } }] }), null);
  assert.equal(readAssistantContent({}), null);
});

test("Request ID lookup is scoped and never invents an error", () => {
  assert.equal(extractSupportRequestId("  threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  "), "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(extractSupportRequestId("请看 threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 这次"), "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(extractSupportRequestId("??"), null);
  const missing = formatRequestLookup(null);
  assert.match(missing, /找不到这条调用/);
  assert.match(missing, /不要编造错误原因/);
  const found = formatRequestLookup({
    requestId: "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "upstream_error",
    clientModel: "glm-5.3-flash",
    providerCode: "glm",
    protocol: "openai_chat",
    createdAt: "2026-09-09T00:00:00.000Z",
    httpStatus: 401,
    upstreamStatus: 401,
    errorCode: "invalid_api_key",
    errorMessage: "invalid api key",
    ownerName: null,
  });
  assert.match(found, /threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(found, /invalid_api_key/);
  assert.doesNotMatch(found, /keyEncrypted|phone/i);
});

test("parses OpenAI tool calls without treating them as empty content", () => {
  const parsed = parseSupportCompletion({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [
            {
              id: "call_docs",
              type: "function",
              function: { name: "retrieve_docs", arguments: "{\"query\":\"Base URL\"}" },
            },
          ],
        },
      },
    ],
  });
  assert.equal(parsed?.stopReason, "toolUse");
  assert.equal(parsed?.toolCalls[0]?.name, "retrieve_docs");
  assert.equal(parsed?.toolCalls[0]?.arguments.query, "Base URL");
  assert.equal(readAssistantContent({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "call_docs",
              type: "function",
              function: { name: "retrieve_docs", arguments: "{}" },
            },
          ],
        },
      },
    ],
  }), null);
});

test("LLM payload keeps system + last 8 history + current user", () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `m${index}`,
  }));
  const messages = buildSupportLlmMessages({
    system: "sys",
    history,
    userMessage: "now",
  });
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages.at(-1)?.content, "now");
  assert.equal(messages.length, 10);
  assert.equal(messages[1]?.content, "m2");
});

test("successful turn writes user + assistant and never mentions relay quota", async () => {
  const store = createMemorySupportChatStore();
  let invokeCount = 0;
  const result = await runSupportChatTurn({
    employeeId: 41,
    message: "Base URL 是什么",
    store,
    complete: async () => {
      invokeCount += 1;
      return "请使用当前站点的 /ai，不要加端口。";
    },
  });
  assert.equal(result.conversationId, 1);
  assert.equal(invokeCount, 1);
  const dumped = store.dump();
  assert.equal(dumped.messages.length, 2);
  assert.equal(dumped.messages[0]?.role, "user");
  assert.equal(dumped.messages[1]?.role, "assistant");

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  for (const rel of [
    "src/routes/support.ts",
    "src/lib/support-bot/invoke.ts",
    "src/lib/support-bot/chat.ts",
    "src/lib/support-bot/account-context.ts",
    "src/lib/support-bot/agent.ts",
    "src/lib/support-bot/tools.ts",
    "src/lib/support-bot/invite-contacts.ts",
    "src/lib/support-bot/lookup-request.ts",
  ]) {
    const source = readFileSync(resolve(root, rel), "utf8");
    assert.doesNotMatch(source, /acquireRelayQuota/);
    assert.doesNotMatch(source, /decryptEmployeeApiKey|employeeApiKeys\.keyEncrypted/);
  }
});

test("invoke failure keeps the user message and writes no empty assistant", async () => {
  const store = createMemorySupportChatStore();
  await assert.rejects(
    () =>
      runSupportChatTurn({
        employeeId: 41,
        message: "hello",
        store,
        complete: async () => {
          throw new SupportBotError(502, "SUPPORT_BOT_UPSTREAM_ERROR", "down");
        },
      }),
    (error: unknown) => error instanceof SupportBotError && error.httpStatus === 502,
  );
  const dumped = store.dump();
  assert.equal(dumped.messages.length, 1);
  assert.equal(dumped.messages[0]?.role, "user");
});

test("unauthenticated support routes return 401", async () => {
  const app = Fastify();
  await app.register(supportRoutes);
  await app.ready();
  try {
    const status = await app.inject({ method: "GET", url: "/api/support/status" });
    const history = await app.inject({ method: "GET", url: "/api/support/history" });
    const chat = await app.inject({
      method: "POST",
      url: "/api/support/chat",
      payload: { message: "hi" },
    });
    assert.equal(status.statusCode, 401);
    assert.equal(history.statusCode, 401);
    assert.equal(chat.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("status payload matches the enabled flag without calling upstream", async () => {
  const app = Fastify();
  app.addHook("onRequest", attachSession(employeeSession));
  await app.register(supportRoutes);
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/support/status" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      success: true,
      data: { enabled: env.SUPPORT_BOT_ENABLED },
    });
  } finally {
    await app.close();
  }
});

test("empty chat message returns 400", async () => {
  const app = Fastify();
  app.addHook("onRequest", attachSession(employeeSession));
  await app.register(supportRoutes);
  await app.ready();
  try {
    const empty = await app.inject({
      method: "POST",
      url: "/api/support/chat",
      payload: { message: "   " },
    });
    assert.equal(empty.statusCode, 400);
    const body = empty.json() as {
      success: boolean;
      error: { code: string; message: string };
    };
    assert.equal(body.success, false);
    assert.equal(body.error.code, "INVALID_MESSAGE");
  } finally {
    await app.close();
  }
});

test("chat without override or channel is 503", async () => {
  const previous = { ...supportBotRuntime };
  supportBotRuntime.consumeRateLimit = async () => {};
  supportBotRuntime.resolveTransport = async () => {
    throw new SupportBotError(503, "SUPPORT_BOT_UNAVAILABLE", "问答助手暂时不可用，请稍后再试或查看接入教程");
  };
  const app = Fastify();
  app.addHook("onRequest", attachSession(employeeSession));
  await app.register(supportRoutes);
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/support/chat",
      payload: { message: "hello" },
    });
    assert.equal(response.statusCode, 503);
    const body = response.json() as { success: boolean; error: { code: string } };
    assert.equal(body.error.code, "SUPPORT_BOT_UNAVAILABLE");
  } finally {
    Object.assign(supportBotRuntime, previous);
    await app.close();
  }
});

test("mocked successful chat persists two messages without quota", async () => {
  const store = createMemorySupportChatStore();
  const previous = { ...supportBotRuntime };
  let invokeCount = 0;
  supportBotRuntime.consumeRateLimit = async () => {};
  supportBotRuntime.resolveTransport = async () => ({ kind: "override" });
  supportBotRuntime.createStore = () => store;
  supportBotRuntime.runAgent = async () => {
    invokeCount += 1;
    return "Base URL 是当前站点的 /ai。";
  };

  const app = Fastify();
  app.addHook("onRequest", attachSession(employeeSession));
  await app.register(supportRoutes);
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/support/chat",
      payload: { message: "怎么配 Base URL" },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      success: boolean;
      data: { conversationId: number; reply: string };
    };
    assert.equal(body.success, true);
    assert.equal(body.data.conversationId, 1);
    assert.match(body.data.reply, /\/ai/);
    assert.equal(invokeCount, 1);
    assert.equal(store.dump().messages.length, 2);
  } finally {
    Object.assign(supportBotRuntime, previous);
    await app.close();
  }
});
