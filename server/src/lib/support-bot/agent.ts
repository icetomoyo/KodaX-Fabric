import { Agent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import { env } from "../../config.js";
import type { LoadSupportAccountContextInput } from "./account-context.js";
import { supportBotUpstreamError } from "./errors.js";
import type { SupportBotTransport } from "./invoke.js";
import { buildSupportAgentSystemPrompt } from "./knowledge.js";
import { createSupportBotStreamFn, EMPTY_USAGE, supportBotModel } from "./stream.js";
import {
  createSupportAgentTools,
  isSupportBotToolName,
  type SupportAgentToolContext,
} from "./tools.js";

export type SupportAgentHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RunSupportAgentInput = {
  transport: SupportBotTransport;
  account: LoadSupportAccountContextInput;
  history: SupportAgentHistoryMessage[];
  userMessage: string;
  streamFn?: StreamFn;
  tools?: ReturnType<typeof createSupportAgentTools>;
  toolContext?: Partial<SupportAgentToolContext>;
};

function historyToAgentMessages(
  history: SupportAgentHistoryMessage[],
  modelId: string,
): AgentMessage[] {
  return history.slice(-8).map((item) => {
    if (item.role === "user") {
      return { role: "user", content: item.content, timestamp: Date.now() };
    }
    return {
      role: "assistant",
      content: [{ type: "text", text: item.content }],
      api: "openai-completions",
      provider: "tokenhub-support",
      model: modelId,
      usage: EMPTY_USAGE,
      stopReason: "stop",
      timestamp: Date.now(),
    };
  });
}

export function extractAssistantText(messages: AgentMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  return null;
}

export async function runSupportAgent(input: RunSupportAgentInput): Promise<string> {
  const model = supportBotModel(env.SUPPORT_BOT_MODEL, env.SUPPORT_BOT_UPSTREAM_BASE_URL);
  const tools =
    input.tools ??
    createSupportAgentTools({
      account: input.account,
      ...input.toolContext,
    });
  const streamFn = input.streamFn ?? createSupportBotStreamFn(input.transport);
  let turns = 0;

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSupportAgentSystemPrompt(input.account.relayBaseUrl),
      model,
      thinkingLevel: "off",
      tools,
      messages: historyToAgentMessages(input.history, model.id),
    },
    streamFn,
    toolExecution: "sequential",
    beforeToolCall: async ({ toolCall }) => {
      if (!isSupportBotToolName(toolCall.name)) {
        return {
          block: true,
          reason: "该工具不可用。Token Bot 只能查询当前账号、按 Request ID 查调用，或查找邀请人。",
          terminate: true,
        };
      }
      return undefined;
    },
    shouldStopAfterTurn: () => {
      turns += 1;
      return turns >= env.SUPPORT_BOT_AGENT_MAX_TURNS;
    },
  });

  const timer = setTimeout(() => agent.abort(), env.SUPPORT_BOT_AGENT_TIMEOUT_MS);
  timer.unref?.();
  try {
    await agent.prompt(input.userMessage);
  } finally {
    clearTimeout(timer);
  }

  if (agent.state.errorMessage) {
    throw supportBotUpstreamError();
  }
  const reply = extractAssistantText(agent.state.messages);
  if (!reply) {
    throw supportBotUpstreamError();
  }
  return reply;
}
