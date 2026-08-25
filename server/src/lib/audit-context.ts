import type { RelayProtocol } from "./relay/protocol.js";

type JsonRecord = Record<string, unknown>;

export type NormalizedAuditContext = {
  requestId: string;
  truncated: boolean;
  tabs: {
    userPrompt: { messages: unknown[]; raw: unknown };
    response: { content: unknown[]; raw: unknown };
    skills: { tools: unknown[]; toolCalls: unknown[]; skills: unknown[] };
    metadata: {
      protocol: RelayProtocol;
      clientModel: string;
      upstreamModel: string | null;
      requestBodySize: number;
      responseBodySize: number;
    };
  };
};

const OMITTED_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "xapikey",
  "apikey",
  "authorizationtoken",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "password",
  "passwd",
  "secret",
  "cookie",
  "setcookie",
  "credential",
  "credentials",
  "privatekey",
  "headers",
  "requestheaders",
  "responseheaders",
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A second defensive pass ensures management views never expose secrets or headers. */
export function sanitizeContextValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const visit = (current: unknown): unknown => {
    if (current === null || typeof current !== "object") return current;
    if (seen.has(current)) return "[CIRCULAR]";
    seen.add(current);
    if (Array.isArray(current)) return current.map(visit);

    const result: JsonRecord = {};
    const record = current as JsonRecord;
    for (const [key, child] of Object.entries(record)) {
      if (OMITTED_KEYS.has(normalizedKey(key))) continue;
      if (key === "preview" && record.truncated === true && typeof child === "string") {
        try {
          result[key] = visit(JSON.parse(child));
        } catch {
          // A byte-limited preview is commonly incomplete JSON. Omitting it is
          // safer than returning serialized header or credential field names.
          result[key] = "[TRUNCATED_PREVIEW_OMITTED]";
        }
        continue;
      }
      result[key] = visit(child);
    }
    return result;
  };
  return visit(value);
}

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function messageList(request: unknown): unknown[] {
  if (!isRecord(request)) return [];
  const messages = request.messages;
  if (Array.isArray(messages)) return messages;

  const input = request.input;
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (Array.isArray(input)) {
    return input.flatMap((item) => {
      if (typeof item === "string") return [{ role: "user", content: item }];
      if (!isRecord(item)) return [];
      if ("role" in item || "content" in item) return [item];
      if (item.type === "input_text" && typeof item.text === "string") {
        return [{ role: "user", content: item }];
      }
      return [];
    });
  }

  if (typeof request.prompt === "string") {
    return [{ role: "user", content: request.prompt }];
  }
  return [];
}

function responseContent(response: unknown): unknown[] {
  if (!isRecord(response)) return response == null ? [] : [response];
  if (Array.isArray(response.choices)) {
    return response.choices.map((choice) => {
      if (!isRecord(choice)) return choice;
      return {
        index: choice.index,
        finishReason: choice.finish_reason,
        content: choice.message ?? choice.delta ?? choice.text ?? choice,
      };
    });
  }
  if (Array.isArray(response.output)) return response.output;
  if (Array.isArray(response.content)) return response.content;
  if (typeof response.output_text === "string") return [response.output_text];
  return [];
}

function collectToolCalls(value: unknown, result: unknown[], seen: WeakSet<object>) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectToolCalls(item, result, seen);
    return;
  }
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    const normalized = normalizedKey(key);
    if (normalized === "toolcalls") {
      if (Array.isArray(child)) result.push(...child);
      else if (child != null) result.push(child);
      continue;
    }
    if (normalized === "functioncall") {
      if (child != null) result.push(child);
      continue;
    }
    if (isRecord(child)) {
      const type = typeof child.type === "string" ? child.type.toLowerCase() : "";
      if (type.includes("tool") || type.includes("function_call")) result.push(child);
    }
    collectToolCalls(child, result, seen);
  }
}

function arrayField(record: JsonRecord | null, ...keys: string[]): unknown[] {
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value != null) return [value];
  }
  return [];
}

const DROPPED_MESSAGE_ROLES = new Set(["system", "developer"]);
const DROPPED_BLOCK_TYPES = new Set([
  "thinking",
  "redacted_thinking",
  "reasoning",
]);
const MEDIA_BLOCK_TYPES = new Set([
  "image",
  "image_url",
  "input_image",
  "file",
  "input_file",
  "audio",
  "input_audio",
  "video",
]);

function isDroppedRole(role: unknown): boolean {
  return typeof role === "string" && DROPPED_MESSAGE_ROLES.has(role.toLowerCase());
}

function slimToolCall(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const fn = isRecord(value.function) ? value.function : null;
  const slim: JsonRecord = {};
  if (value.id != null) slim.id = value.id;
  if (value.type != null) slim.type = value.type;
  const name = fn?.name ?? value.name;
  if (name != null) slim.name = name;
  const args = fn?.arguments ?? value.arguments ?? value.input;
  if (args !== undefined) slim.arguments = args;
  return slim;
}

function slimContentBlock(block: unknown): unknown {
  if (block == null || typeof block === "string" || typeof block === "number") return block;
  if (!isRecord(block)) return block;
  const type = typeof block.type === "string" ? block.type.toLowerCase() : "";
  if (DROPPED_BLOCK_TYPES.has(type)) return null;
  if (MEDIA_BLOCK_TYPES.has(type)) {
    return { type: block.type, omitted: true };
  }
  if (type === "tool_use" || type === "server_tool_use") {
    return {
      type: block.type,
      ...(block.id != null ? { id: block.id } : {}),
      ...(block.name != null ? { name: block.name } : {}),
      ...(block.input !== undefined ? { input: block.input } : {}),
    };
  }
  if (type === "tool_result") {
    return {
      type: block.type,
      ...(block.tool_use_id != null ? { tool_use_id: block.tool_use_id } : {}),
      ...(block.is_error !== undefined ? { is_error: block.is_error } : {}),
      ...(block.content !== undefined ? { content: slimContent(block.content) } : {}),
    };
  }
  if (typeof block.text === "string") {
    return block.type ? { type: block.type, text: block.text } : block.text;
  }
  if (block.content !== undefined) {
    const slim: JsonRecord = {};
    if (block.type != null) slim.type = block.type;
    slim.content = slimContent(block.content);
    return slim;
  }
  if (block.type != null) return { type: block.type };
  return block;
}

function slimContent(content: unknown): unknown {
  if (Array.isArray(content)) {
    return content.map(slimContentBlock).filter((item) => item != null);
  }
  return slimContentBlock(content);
}

function slimMessage(message: unknown): unknown {
  if (!isRecord(message)) return message;
  const slim: JsonRecord = {};
  if (typeof message.role === "string") slim.role = message.role;
  if (typeof message.name === "string") slim.name = message.name;
  if (typeof message.tool_call_id === "string") slim.tool_call_id = message.tool_call_id;
  if (message.content !== undefined) slim.content = slimContent(message.content);
  if (Array.isArray(message.tool_calls)) {
    slim.tool_calls = message.tool_calls.map(slimToolCall);
  }
  return slim;
}

function slimResponse(response: unknown): unknown {
  if (response == null) return null;
  const sanitized = sanitizeContextValue(parseJsonLike(response));
  if (!isRecord(sanitized)) return sanitized;
  if (Array.isArray(sanitized.choices)) {
    return {
      choices: sanitized.choices.map((choice) => {
        if (!isRecord(choice)) return choice;
        const message = isRecord(choice.message) ? slimMessage(choice.message) : undefined;
        const slim: JsonRecord = {};
        if (choice.index !== undefined) slim.index = choice.index;
        if (choice.finish_reason !== undefined) slim.finish_reason = choice.finish_reason;
        if (message !== undefined) slim.message = message;
        else if (choice.delta !== undefined) slim.delta = slimMessage(choice.delta);
        else if (choice.text !== undefined) slim.text = slimContent(choice.text);
        return slim;
      }),
    };
  }
  if (Array.isArray(sanitized.content)) {
    const slim: JsonRecord = { content: slimContent(sanitized.content) };
    if (sanitized.stop_reason !== undefined) slim.stop_reason = sanitized.stop_reason;
    return slim;
  }
  if (sanitized.error != null) {
    const error = isRecord(sanitized.error)
      ? {
        ...(typeof sanitized.error.type === "string" ? { type: sanitized.error.type } : {}),
        ...(typeof sanitized.error.code === "string" || typeof sanitized.error.code === "number"
          ? { code: sanitized.error.code }
          : {}),
        ...(typeof sanitized.error.message === "string" ? { message: sanitized.error.message } : {}),
      }
      : sanitized.error;
    return { error };
  }
  if (typeof sanitized.output_text === "string") return { output_text: sanitized.output_text };
  if (Array.isArray(sanitized.output)) return { output: slimContent(sanitized.output) };
  return sanitized;
}

/**
 * Persist only business-facing conversation data: user/assistant/tool turns,
 * visible model output, and tool invocations. System prompts, tool schemas,
 * skills packs, thinking traces, and binary attachments are dropped.
 */
export function extractBusinessAuditBodies(input: {
  requestBody: unknown;
  responseBody: unknown;
}): { requestBody: unknown; responseBody: unknown } {
  const request = sanitizeContextValue(parseJsonLike(input.requestBody));
  const messages = messageList(request)
    .filter((message) => !isRecord(message) || !isDroppedRole(message.role))
    .map(slimMessage);
  return {
    requestBody: { messages },
    responseBody: slimResponse(input.responseBody),
  };
}

export function normalizeAuditContext(input: {
  requestId: string;
  protocol: RelayProtocol;
  clientModel: string;
  upstreamModel: string | null;
  requestBody: unknown;
  responseBody: unknown;
  requestBodySize: number | null;
  responseBodySize: number | null;
  truncated: boolean;
}): NormalizedAuditContext {
  const request = sanitizeContextValue(parseJsonLike(input.requestBody));
  const response = sanitizeContextValue(parseJsonLike(input.responseBody));
  const requestRecord = isRecord(request) ? request : null;
  const responseRecord = isRecord(response) ? response : null;
  const toolCalls: unknown[] = [];
  collectToolCalls(request, toolCalls, new WeakSet());
  collectToolCalls(response, toolCalls, new WeakSet());

  return {
    requestId: input.requestId,
    truncated: input.truncated,
    tabs: {
      userPrompt: {
        messages: messageList(request),
        raw: request,
      },
      response: {
        content: responseContent(response),
        raw: response,
      },
      skills: {
        tools: arrayField(requestRecord, "tools", "functions"),
        toolCalls,
        skills: [
          ...arrayField(requestRecord, "skills"),
          ...arrayField(responseRecord, "skills"),
        ],
      },
      metadata: {
        protocol: input.protocol,
        clientModel: input.clientModel,
        upstreamModel: input.upstreamModel,
        requestBodySize: input.requestBodySize ?? 0,
        responseBodySize: input.responseBodySize ?? 0,
      },
    },
  };
}
