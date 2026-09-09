import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { InviteDirectory } from "../src/lib/support-bot/invite-contacts.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { extractAssistantText, runSupportAgent } = await import("../src/lib/support-bot/agent.js");
const { selectInviteContacts } = await import("../src/lib/support-bot/invite-contacts.js");
const { EMPTY_USAGE, contextToOpenAiMessages, supportBotModel } = await import(
  "../src/lib/support-bot/stream.js"
);
const { SUPPORT_BOT_TOOL_NAMES, createSupportAgentTools } = await import(
  "../src/lib/support-bot/tools.js"
);

const directory: InviteDirectory = {
  enterprises: [
    { id: 1, name: "海致科技" },
    { id: 2, name: "海致星图" },
  ],
  teams: [
    {
      id: 11,
      name: "平台组",
      enterpriseId: 1,
      departmentId: 101,
      departmentName: "研发部",
      enterpriseName: "海致科技",
    },
    {
      id: 12,
      name: "华北",
      enterpriseId: 1,
      departmentId: 102,
      departmentName: "销售部",
      enterpriseName: "海致科技",
    },
  ],
  admins: [
    { name: "王企管", role: "org_admin", enterpriseId: 1, departmentId: null, teamId: null },
    { name: "李部门", role: "dept_admin", enterpriseId: 1, departmentId: 101, teamId: null },
    { name: "张团队", role: "team_admin", enterpriseId: 1, departmentId: 101, teamId: 11 },
  ],
};

const account = {
  employeeId: 41,
  role: "employee" as const,
  relayBaseUrl: "https://tokenhub.haizhi.com/ai",
};

test("invite lookup requires names, stays read-only, and never mentions phones", () => {
  const needNames = selectInviteContacts(directory, {});
  assert.equal(needNames.status, "need_names");

  const missing = selectInviteContacts(directory, { enterpriseName: "不存在的公司" });
  assert.equal(missing.status, "not_found");

  const ambiguous = selectInviteContacts(directory, { enterpriseName: "海致" });
  assert.equal(ambiguous.status, "ambiguous");
  assert.match(ambiguous.message, /海致科技/);
  assert.match(ambiguous.message, /海致星图/);

  const found = selectInviteContacts(directory, {
    enterpriseName: "海致科技",
    teamName: "平台组",
  });
  assert.equal(found.status, "found");
  assert.match(found.message, /张团队/);
  assert.match(found.message, /团队管理员/);
  assert.doesNotMatch(found.message, /李部门|王企管/);
  assert.doesNotMatch(found.message, /1[3-9]\d{9}/);
  assert.doesNotMatch(found.message, /phone/i);
  assert.equal(found.matches[0]?.contacts.every((item) => item.name !== ""), true);

  const enterpriseOnly = selectInviteContacts(directory, { enterpriseName: "海致科技" });
  assert.equal(enterpriseOnly.status, "found");
  assert.match(enterpriseOnly.message, /王企管/);
  assert.match(enterpriseOnly.message, /团队名/);
});

test("Token Bot tools are account, request, and invite lookup only", async () => {
  const tools = createSupportAgentTools({
    account,
    lookupAccount: async () => "角色：employee",
    lookupRequest: async () => "找不到这条调用",
    lookupInvite: async () => "need names",
  });
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [...SUPPORT_BOT_TOOL_NAMES].sort(),
  );
  assert.ok(tools.every((tool) => !["bash", "write", "edit", "read", "retrieve_docs"].includes(tool.name)));
  const lookup = tools.find((tool) => tool.name === "lookup_request");
  const result = await lookup!.execute("call_1", { requestId: "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  assert.equal(result.content[0]?.type, "text");
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /找不到这条调用/);
});

function assistantFrom(input: {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  if (input.text) content.push({ type: "text", text: input.text });
  for (const call of input.toolCalls ?? []) {
    content.push({ type: "toolCall", id: call.id, name: call.name, arguments: call.arguments });
  }
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "tokenhub-support",
    model: "glm-5.3-flash",
    usage: EMPTY_USAGE,
    stopReason: input.toolCalls?.length ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

function scriptedStreamFn(
  replies: Array<{
    text?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  }>,
): StreamFn {
  let index = 0;
  return (_model, _context: Context) => {
    const stream = createAssistantMessageEventStream();
    const reply = replies[Math.min(index, replies.length - 1)] ?? { text: "好的。" };
    index += 1;
    const assistant = assistantFrom(reply);
    queueMicrotask(() => {
      stream.push({ type: "start", partial: assistant });
      let contentIndex = 0;
      if (reply.text) {
        stream.push({ type: "text_start", contentIndex, partial: assistant });
        stream.push({ type: "text_delta", contentIndex, delta: reply.text, partial: assistant });
        stream.push({ type: "text_end", contentIndex, content: reply.text, partial: assistant });
        contentIndex += 1;
      }
      for (const call of reply.toolCalls ?? []) {
        const toolCall = {
          type: "toolCall" as const,
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        };
        stream.push({ type: "toolcall_start", contentIndex, partial: assistant });
        stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: assistant });
        contentIndex += 1;
      }
      stream.push({
        type: "done",
        reason: assistant.stopReason === "toolUse" ? "toolUse" : "stop",
        message: assistant,
      });
      stream.end(assistant);
    });
    return stream;
  };
}

test("Pi Agent looks up a Request ID then answers from the tool result", async () => {
  const reply = await runSupportAgent({
    transport: { kind: "override" },
    account,
    history: [],
    userMessage: "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 这次为啥失败",
    streamFn: scriptedStreamFn([
      {
        toolCalls: [
          {
            id: "call_req",
            name: "lookup_request",
            arguments: { requestId: "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          },
        ],
      },
      {
        text: "这次是 401 invalid_api_key，Key 没粘完整。",
      },
    ]),
    toolContext: {
      lookupAccount: async () => "角色：employee",
      lookupRequest: async () => "状态：upstream_error\nerrorCode：invalid_api_key",
      lookupInvite: async () => "need names",
    },
  });
  assert.match(reply, /invalid_api_key/);
});

test("context conversion keeps tool results for the next LLM turn", () => {
  const model = supportBotModel("glm-5.3-flash", "https://example.com/v1");
  assert.equal(model.compat?.supportsDeveloperRole, false);
  const messages = contextToOpenAiMessages({
    systemPrompt: "sys",
    messages: [
      { role: "user", content: "hi", timestamp: 1 },
      assistantFrom({
        toolCalls: [
          {
            id: "call_1",
            name: "lookup_request",
            arguments: { requestId: "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          },
        ],
      }),
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "lookup_request",
        content: [{ type: "text", text: "status=upstream_error" }],
        isError: false,
        timestamp: 3,
      },
    ],
  });
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[2]?.role, "assistant");
  assert.equal(messages[2]?.tool_calls?.[0]?.function.name, "lookup_request");
  assert.equal(messages[3]?.role, "tool");
  assert.equal(messages[3]?.tool_call_id, "call_1");
});

test("extractAssistantText skips tool-only assistant turns", () => {
  const text = extractAssistantText([
    assistantFrom({
      toolCalls: [
        {
          id: "call_1",
          name: "lookup_request",
          arguments: { requestId: "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        },
      ],
    }),
    assistantFrom({ text: "请用 /ai" }),
  ]);
  assert.equal(text, "请用 /ai");
});
