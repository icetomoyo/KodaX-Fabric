import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  invokeSupportBotCompletion,
  type SupportBotTransport,
  type SupportLlmMessage,
  type SupportOpenAiTool,
  type SupportToolCall,
} from "./invoke.js";

export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function supportBotModel(modelId: string, baseUrl: string): Model<"openai-completions"> {
  return {
    id: modelId,
    name: "Token Bot",
    api: "openai-completions",
    provider: "tokenhub-support",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 1_500,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
      requiresToolResultName: true,
    },
  };
}

function textFromContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

export function contextToOpenAiMessages(context: Context): SupportLlmMessage[] {
  const messages: SupportLlmMessage[] = [];
  if (context.systemPrompt?.trim()) {
    messages.push({ role: "system", content: context.systemPrompt });
  }
  for (const message of context.messages) {
    if (message.role === "user") {
      messages.push({ role: "user", content: textFromContent(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
      const toolCalls = message.content.filter((part): part is ToolCall => part.type === "toolCall");
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls:
          toolCalls.length > 0
            ? toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
              }))
            : undefined,
      });
      continue;
    }
    if (message.role === "toolResult") {
      messages.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        name: message.toolName,
        content: textFromContent(message.content),
      });
    }
  }
  return messages;
}

export function toolsToOpenAi(context: Context): SupportOpenAiTool[] {
  return (context.tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function toAssistantMessage(
  model: Model<"openai-completions">,
  content: string,
  toolCalls: SupportToolCall[],
  stopReason: "stop" | "toolUse",
  errorMessage?: string,
): AssistantMessage {
  const blocks: AssistantMessage["content"] = [];
  if (content) {
    blocks.push({ type: "text", text: content });
  }
  for (const call of toolCalls) {
    blocks.push({
      type: "toolCall",
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    });
  }
  return {
    role: "assistant",
    content: blocks,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: errorMessage ? "error" : stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

export function createSupportBotStreamFn(transport: SupportBotTransport): StreamFn {
  return (model, context: Context, options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
        const completion = await invokeSupportBotCompletion(
          contextToOpenAiMessages(context),
          transport,
          toolsToOpenAi(context),
          options?.signal,
        );
        const assistant = toAssistantMessage(
          model as Model<"openai-completions">,
          completion.content,
          completion.toolCalls,
          completion.stopReason,
        );
        stream.push({ type: "start", partial: assistant });
        let contentIndex = 0;
        if (completion.content) {
          stream.push({ type: "text_start", contentIndex, partial: assistant });
          stream.push({
            type: "text_delta",
            contentIndex,
            delta: completion.content,
            partial: assistant,
          });
          stream.push({
            type: "text_end",
            contentIndex,
            content: completion.content,
            partial: assistant,
          });
          contentIndex += 1;
        }
        for (const call of completion.toolCalls) {
          const toolCall: ToolCall = {
            type: "toolCall",
            id: call.id,
            name: call.name,
            arguments: call.arguments,
          };
          stream.push({ type: "toolcall_start", contentIndex, partial: assistant });
          stream.push({
            type: "toolcall_end",
            contentIndex,
            toolCall,
            partial: assistant,
          });
          contentIndex += 1;
        }
        stream.push({
          type: "done",
          reason: completion.stopReason,
          message: assistant,
        });
        stream.end(assistant);
      } catch (error) {
        const message = error instanceof Error ? error.message : "问答助手暂时无法回答，请稍后再试";
        const assistant = toAssistantMessage(
          model as Model<"openai-completions">,
          "",
          [],
          "stop",
          message,
        );
        assistant.stopReason = options?.signal?.aborted ? "aborted" : "error";
        stream.push({
          type: "error",
          reason: assistant.stopReason === "aborted" ? "aborted" : "error",
          error: assistant,
        });
        stream.end(assistant);
      }
    })();
    return stream;
  };
}
