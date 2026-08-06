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
