import { GLM_TEXT_CATALOG_MODEL } from "./discovered-models.js";
import { extractUpstreamUsageCap } from "./glm-error-codes.js";
import { getProviderTemplate, isTestableUpstreamUrl } from "./provider-templates.js";
import {
  DEFAULT_RELAY_PROTOCOL,
  type RelayProtocol,
} from "./relay/protocol.js";
import {
  buildRelayUpstreamHeaders,
  buildRelayUpstreamUrl,
  type RelayUpstreamOperation,
} from "./relay/upstream.js";

export const UPSTREAM_CONNECTION_TEST_TIMEOUT_MS = 20_000;
const TEST_PROMPT = "ping";
const TEST_MAX_TOKENS = 8;

export type UpstreamBusinessFailure = {
  code: string | null;
  message: string | null;
};

export type UpstreamConnectionTestResult = {
  ok: boolean;
  testedAt: string;
  latencyMs: number;
  httpStatus: number | null;
  modelCount: number;
  models: string[];
  message: string;
  protocol: RelayProtocol;
  rawBody: string | null;
};

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Some compatible gateways return HTTP 200 for an authentication failure and
 * communicate failure only through a JSON envelope such as
 * `{ success: false, code: 401, msg: "..." }`.
 */
export function parseUpstreamBusinessFailure(
  payload: unknown,
): UpstreamBusinessFailure | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const object = payload as Record<string, unknown>;
  if (object.success !== false) return null;

  const error = object.error;
  const nestedErrorMessage = error && typeof error === "object" && !Array.isArray(error)
    ? nonEmptyText((error as Record<string, unknown>).message)
    : null;
  const code = typeof object.code === "number" || typeof object.code === "string"
    ? String(object.code)
    : null;
  return {
    code,
    message: nonEmptyText(object.msg)
      ?? nonEmptyText(object.message)
      ?? nonEmptyText(error)
      ?? nestedErrorMessage,
  };
}

export function formatUpstreamBusinessFailure(
  failure: UpstreamBusinessFailure,
): string {
  const code = failure.code ? `（${failure.code}）` : "";
  const detail = failure.message ? `：${failure.message.slice(0, 500)}` : "";
  return `上游返回业务错误${code}${detail}`;
}

export function parseUpstreamModels(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
        return (item as { id: string }).id;
      }
      return null;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 200);
}

export function summarizeUpstreamHttpError(status: number, raw: string): string {
  let detail = raw.trim();
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    if (typeof parsed.error === "string") detail = parsed.error;
    if (parsed.error && typeof parsed.error === "object" && typeof parsed.error.message === "string") {
      detail = parsed.error.message;
    }
    if (typeof parsed.message === "string") detail = parsed.message;
  } catch {
    // Keep the text response when the upstream does not return JSON.
  }
  const suffix = detail ? `：${detail.slice(0, 500)}` : "";
  return `上游返回 HTTP ${status}${suffix}`;
}

export function resolveUpstreamTestProtocol(
  supportedProtocols: RelayProtocol[] | null | undefined,
  preferred?: RelayProtocol,
): RelayProtocol {
  const supported = supportedProtocols ?? [];
  if (supported.length === 0) {
    throw new Error("该渠道未声明任何支持协议");
  }

  if (supported.includes("openai_chat")) return "openai_chat";

  if (preferred) {
    if (!supported.includes(preferred)) {
      throw new Error("该渠道未声明支持所选协议");
    }
    return preferred;
  }

  return supported.includes(DEFAULT_RELAY_PROTOCOL)
    ? DEFAULT_RELAY_PROTOCOL
    : supported[0];
}

export function resolveUpstreamTestModel(
  providerCode: string,
  discoveredModels?: readonly string[] | null,
): string {
  const discovered = discoveredModels
    ?.map((name) => name.trim())
    .find((name) => name.length > 0);
  if (discovered) return discovered;
  if (providerCode === "glm") return GLM_TEXT_CATALOG_MODEL;
  if (providerCode === "deepseek") return "deepseek-chat";
  throw new Error("无法确定测试模型");
}

function inferenceOperation(protocol: RelayProtocol): RelayUpstreamOperation {
  if (protocol === "anthropic_messages") return "messages";
  if (protocol === "openai_responses") return "responses";
  return "chat_completions";
}

export function buildUpstreamTestBody(
  protocol: RelayProtocol,
  model: string,
): Record<string, unknown> {
  if (protocol === "anthropic_messages") {
    return {
      model,
      max_tokens: TEST_MAX_TOKENS,
      messages: [{ role: "user", content: TEST_PROMPT }],
    };
  }
  if (protocol === "openai_responses") {
    return {
      model,
      input: TEST_PROMPT,
      max_output_tokens: TEST_MAX_TOKENS,
    };
  }
  return {
    model,
    messages: [{ role: "user", content: TEST_PROMPT }],
    max_tokens: TEST_MAX_TOKENS,
    stream: false,
  };
}

function uniqueModels(model: string, discovered?: readonly string[] | null): string[] {
  const names = [model, ...(discovered ?? [])]
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return [...new Set(names)].slice(0, 200);
}

export async function probeUpstreamModels(input: {
  providerCode: string;
  protocol: RelayProtocol;
  baseUrl: string;
  authStyle: string;
  secret: string;
  model?: string;
  discoveredModels?: readonly string[] | null;
  timeoutMs?: number;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<UpstreamConnectionTestResult> {
  if (!isTestableUpstreamUrl(input.providerCode, input.baseUrl)) {
    throw new Error(
      getProviderTemplate(input.providerCode)
        ? "当前仅支持对已确认供应商的官方 HTTPS 地址进行连通性测试"
        : "自定义渠道缺少可测试的上游地址",
    );
  }

  const model = input.model?.trim() || resolveUpstreamTestModel(
    input.providerCode,
    input.discoveredModels,
  );
  const timeoutMs = input.timeoutMs ?? UPSTREAM_CONNECTION_TEST_TIMEOUT_MS;
  const testedAt = (input.now ?? new Date()).toISOString();
  const startedAt = Date.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  const operation = inferenceOperation(input.protocol);

  try {
    const response = await fetchImpl(
      buildRelayUpstreamUrl(input.baseUrl, input.protocol, operation),
      {
        method: "POST",
        headers: buildRelayUpstreamHeaders({
          protocol: input.protocol,
          authStyle: input.authStyle,
          secret: input.secret,
        }),
        body: JSON.stringify(buildUpstreamTestBody(input.protocol, model)),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    const usageCap = extractUpstreamUsageCap(payload);
    const businessFailure = parseUpstreamBusinessFailure(payload);
    const connectionOk = response.ok && businessFailure === null && usageCap === null;
    const models = connectionOk ? uniqueModels(model, input.discoveredModels) : [];
    return {
      ok: connectionOk,
      testedAt,
      latencyMs: Date.now() - startedAt,
      httpStatus: response.status,
      modelCount: models.length,
      models,
      protocol: input.protocol,
      rawBody: raw,
      message: connectionOk
        ? `推理成功（${input.protocol} / ${model}）`
        : usageCap
          ? summarizeUpstreamHttpError(response.status || 429, raw)
          : response.ok && businessFailure
            ? formatUpstreamBusinessFailure(businessFailure)
            : summarizeUpstreamHttpError(response.status, raw),
    };
  } catch (error) {
    const timeoutSeconds = Math.round(timeoutMs / 1000);
    const message = error instanceof Error && error.name === "TimeoutError"
      ? `连接超时（${timeoutSeconds} 秒）`
      : error instanceof Error
        ? error.message
        : String(error);
    return {
      ok: false,
      testedAt,
      latencyMs: Date.now() - startedAt,
      httpStatus: null,
      modelCount: 0,
      models: [],
      protocol: input.protocol,
      rawBody: null,
      message,
    };
  }
}
