import { and, eq, sql } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import { upstreamCredentials } from "../../db/schema/index.js";
import { decryptSecret } from "../crypto-secret.js";
import { beginCredentialUse } from "./credential-load.js";
import {
  DEFAULT_RELAY_PROTOCOL,
  type RelayProtocol,
} from "./protocol.js";
import type { RelayCandidate } from "./types.js";

export type RelayUpstreamAttemptKind =
  | "success"
  | "client_error"
  | "auth_error"
  | "rate_limited"
  | "upstream_error"
  | "network_error"
  | "timeout"
  | "cancelled"
  | "configuration_error";

export type RelayUpstreamAttemptResult = {
  response: Response | null;
  kind: RelayUpstreamAttemptKind;
  retryable: boolean;
  status: number | null;
  latencyMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  /** Release timeout/listener resources after the response body has been consumed. */
  cleanup: () => void;
  /** Abort the upstream response body, for example when the downstream client disconnects. */
  abort: (reason?: unknown) => void;
};

export type SendRelayUpstreamChatInput = {
  candidate: RelayCandidate;
  body: Record<string, unknown>;
  requestId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  cooldownSeconds?: number;
};

export type RelayUpstreamOperation =
  | "models"
  | "chat_completions"
  | "messages"
  | "messages_count_tokens";

export type RelayForwardHeaders = Record<string, string | string[] | undefined>;

export type SendRelayUpstreamInput = {
  candidate: RelayCandidate;
  operation: RelayUpstreamOperation;
  protocol?: RelayProtocol;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  forwardHeaders?: RelayForwardHeaders | Headers;
  requestId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  cooldownSeconds?: number;
  method?: "GET" | "POST";
};

type RequestLifetime = {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
  abort: (reason?: unknown) => void;
};

const OPERATION_PATHS: Record<
  RelayProtocol,
  Partial<Record<RelayUpstreamOperation, string>>
> = {
  openai_chat: {
    models: "models",
    chat_completions: "chat/completions",
  },
  anthropic_messages: {
    models: "v1/models",
    messages: "v1/messages",
    messages_count_tokens: "v1/messages/count_tokens",
  },
};

/** Append a protocol operation without discarding a configured base URL path. */
export function buildRelayUpstreamUrl(
  baseUrl: string,
  protocol: RelayProtocol,
  operation: RelayUpstreamOperation,
): URL {
  let operationPath = OPERATION_PATHS[protocol][operation];
  if (!operationPath) {
    throw new Error(`协议 ${protocol} 不支持上游操作 ${operation}`);
  }

  const base = new URL(baseUrl);
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";

  // Anthropic deployments conventionally configure the origin, while some
  // compatible gateways provide a base URL ending in `/v1`. Avoid `/v1/v1`.
  if (
    protocol === "anthropic_messages" &&
    /\/v1\/$/.test(base.pathname) &&
    operationPath.startsWith("v1/")
  ) {
    operationPath = operationPath.slice(3);
  }
  return new URL(operationPath, base);
}

/** Backward-compatible Chat Completions endpoint builder. */
export function buildRelayUpstreamChatUrl(baseUrl: string): URL {
  return buildRelayUpstreamUrl(baseUrl, DEFAULT_RELAY_PROTOCOL, "chat_completions");
}

function createRequestLifetime(timeoutMs: number, externalSignal?: AbortSignal): RequestLifetime {
  const controller = new AbortController();
  let timedOut = false;
  let cleaned = false;

  const abortFromExternal = () => {
    if (!controller.signal.aborted) controller.abort(externalSignal?.reason);
  };

  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    if (!controller.signal.aborted) {
      controller.abort(new Error(`Upstream timed out after ${timeoutMs}ms`));
    }
  }, timeoutMs);
  timer.unref?.();

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  };

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup,
    abort: (reason?: unknown) => {
      if (!controller.signal.aborted) controller.abort(reason);
      cleanup();
    },
  };
}

function selectedCredential(candidate: RelayCandidate) {
  return and(
    eq(upstreamCredentials.id, candidate.credentialId),
    // An old in-flight request must never disable or cool a newly replaced secret.
    eq(upstreamCredentials.secretEncrypted, candidate.secretEncrypted),
  );
}

async function markCredentialSuccess(candidate: RelayCandidate): Promise<void> {
  const now = new Date();
  await db
    .update(upstreamCredentials)
    .set({
      successCount: sql`${upstreamCredentials.successCount} + 1`,
      lastUsedAt: now,
      status: sql`case
        when ${upstreamCredentials.status} = 'cooling'
          and (${upstreamCredentials.coolUntil} is null or ${upstreamCredentials.coolUntil} <= now())
        then 'active'::credential_status
        else ${upstreamCredentials.status}
      end`,
      coolUntil: sql`case
        when ${upstreamCredentials.status} = 'cooling'
          and (${upstreamCredentials.coolUntil} is null or ${upstreamCredentials.coolUntil} <= now())
        then null
        else ${upstreamCredentials.coolUntil}
      end`,
      lastError: sql`case
        when ${upstreamCredentials.status} in ('active', 'cooling') then null
        else ${upstreamCredentials.lastError}
      end`,
      lastErrorAt: sql`case
        when ${upstreamCredentials.status} in ('active', 'cooling') then null
        else ${upstreamCredentials.lastErrorAt}
      end`,
      updatedAt: now,
    })
    .where(selectedCredential(candidate));
}

async function markCredentialUsed(candidate: RelayCandidate): Promise<void> {
  const now = new Date();
  await db
    .update(upstreamCredentials)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(selectedCredential(candidate));
}

async function markCredentialFailure(
  candidate: RelayCandidate,
  message: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(upstreamCredentials)
    .set({
      errorCount: sql`${upstreamCredentials.errorCount} + 1`,
      lastError: message.slice(0, 1_000),
      lastErrorAt: now,
      lastUsedAt: now,
      updatedAt: now,
    })
    .where(selectedCredential(candidate));
}

async function autoDisableCredential(
  candidate: RelayCandidate,
  status: number,
): Promise<void> {
  const now = new Date();
  await db
    .update(upstreamCredentials)
    .set({
      // Preserve an explicit administrator disable and any newer terminal state.
      status: sql`case
        when ${upstreamCredentials.status} in ('active', 'cooling')
        then 'auto_disabled'::credential_status
        else ${upstreamCredentials.status}
      end`,
      errorCount: sql`${upstreamCredentials.errorCount} + 1`,
      lastError: `HTTP ${status}：上游凭证鉴权失败`,
      lastErrorAt: now,
      lastUsedAt: now,
      updatedAt: now,
    })
    .where(selectedCredential(candidate));
}

async function coolCredential(
  candidate: RelayCandidate,
  cooldownSeconds: number,
): Promise<void> {
  const now = new Date();
  const coolUntil = new Date(now.getTime() + cooldownSeconds * 1_000);
  const coolUntilIso = coolUntil.toISOString();
  await db
    .update(upstreamCredentials)
    .set({
      status: sql`case
        when ${upstreamCredentials.status} in ('active', 'cooling')
        then 'cooling'::credential_status
        else ${upstreamCredentials.status}
      end`,
      coolUntil: sql`case
        when ${upstreamCredentials.status} in ('active', 'cooling')
        then greatest(
          coalesce(${upstreamCredentials.coolUntil}, ${coolUntilIso}::timestamptz),
          ${coolUntilIso}::timestamptz
        )
        else ${upstreamCredentials.coolUntil}
      end`,
      errorCount: sql`${upstreamCredentials.errorCount} + 1`,
      lastError: "HTTP 429：上游限流，凭证已进入冷却",
      lastErrorAt: now,
      lastUsedAt: now,
      updatedAt: now,
    })
    .where(selectedCredential(candidate));
}

function classifyHttpStatus(status: number): {
  kind: RelayUpstreamAttemptKind;
  retryable: boolean;
  errorCode: string | null;
  errorMessage: string | null;
} {
  if (status >= 200 && status < 300) {
    return {
      kind: "success",
      retryable: false,
      errorCode: null,
      errorMessage: null,
    };
  }
  if (status === 400) {
    return {
      kind: "client_error",
      retryable: false,
      errorCode: "upstream_bad_request",
      errorMessage: "上游拒绝了请求参数",
    };
  }
  if (status === 401 || status === 403) {
    return {
      kind: "auth_error",
      retryable: true,
      errorCode: "upstream_auth_error",
      errorMessage: `上游凭证鉴权失败（HTTP ${status}）`,
    };
  }
  if (status === 429) {
    return {
      kind: "rate_limited",
      retryable: true,
      errorCode: "upstream_rate_limited",
      errorMessage: "上游请求频率受限",
    };
  }
  if (status >= 500 && status <= 599) {
    return {
      kind: "upstream_error",
      retryable: true,
      errorCode: "upstream_server_error",
      errorMessage: `上游服务异常（HTTP ${status}）`,
    };
  }
  return {
    kind: status >= 400 && status <= 499 ? "client_error" : "upstream_error",
    retryable: false,
    errorCode: status >= 400 && status <= 499
      ? "upstream_client_error"
      : "upstream_http_error",
    errorMessage: `上游返回 HTTP ${status}`,
  };
}

function safeRequestId(value: string | undefined): string | null {
  if (!value || value.length > 128) return null;
  return /^[\x21-\x7e]+$/.test(value) ? value : null;
}

function isForwardedProtocolHeader(protocol: RelayProtocol, name: string): boolean {
  if (protocol === "anthropic_messages") {
    // Anthropic explicitly treats capability headers as an open list. New
    // Claude Code releases may add anthropic-* headers without a gateway update.
    return name.startsWith("anthropic-");
  }
  return name === "openai-beta";
}

function forwardedHeaderEntries(
  source: RelayForwardHeaders | Headers | undefined,
): Array<[string, string | string[] | undefined]> {
  if (!source) return [];
  if (source instanceof Headers) {
    const entries: Array<[string, string]> = [];
    source.forEach((value, name) => entries.push([name, value]));
    return entries;
  }
  return Object.entries(source);
}

export function sanitizeRelayUpstreamForwardHeaders(
  protocol: RelayProtocol,
  source?: RelayForwardHeaders | Headers,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of forwardedHeaderEntries(source)) {
    const name = rawName.toLowerCase();
    if (!isForwardedProtocolHeader(protocol, name) || rawValue === undefined) continue;
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;
    if (!value || value.length > 8_192 || /[\r\n]/.test(value)) continue;
    result[name] = value;
  }
  return result;
}

export type BuildRelayUpstreamHeadersInput = {
  protocol: RelayProtocol;
  authStyle: string;
  secret: string;
  forwardHeaders?: RelayForwardHeaders | Headers;
  requestId?: string;
};

export function buildRelayUpstreamHeaders(
  input: BuildRelayUpstreamHeadersInput,
): Headers {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "TokenHub/0.1 relay",
  });

  const authStyle = input.authStyle.trim().toLowerCase();
  if (authStyle === "bearer") {
    headers.set("Authorization", `Bearer ${input.secret}`);
  } else if (
    authStyle === "x-api-key" ||
    authStyle === "x_api_key" ||
    authStyle === "api-key" ||
    authStyle === "anthropic"
  ) {
    headers.set("X-Api-Key", input.secret);
  } else {
    throw new Error(`不支持的上游鉴权方式：${input.authStyle}`);
  }

  for (const [name, value] of Object.entries(
    sanitizeRelayUpstreamForwardHeaders(input.protocol, input.forwardHeaders),
  )) {
    headers.set(name, value);
  }
  if (input.protocol === "anthropic_messages" && !headers.has("anthropic-version")) {
    headers.set("anthropic-version", "2023-06-01");
  }

  const requestId = safeRequestId(input.requestId);
  if (requestId) headers.set("X-Request-ID", requestId);
  return headers;
}

/** Include undici/Node syscall details from `error.cause` when present. */
function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "上游网络请求失败";
  }

  const cause = error.cause;
  if (!(cause instanceof Error)) {
    return error.message;
  }

  const code =
    "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
  const detail = code ? `${code}: ${cause.message}` : cause.message;
  return `${error.message} (${detail})`;
}

/**
 * Execute one upstream attempt. The caller owns retry ordering and response-body handling.
 * HTTP responses are deliberately left unread so JSON and SSE can be forwarded byte-for-byte.
 */
export async function sendRelayUpstream(
  input: SendRelayUpstreamInput,
): Promise<RelayUpstreamAttemptResult> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(1, Math.trunc(input.timeoutMs ?? env.RELAY_UPSTREAM_TIMEOUT_MS));
  const cooldownSeconds = Math.max(
    1,
    Math.min(3_600, Math.trunc(input.cooldownSeconds ?? env.RELAY_COOLDOWN_SECONDS)),
  );
  const baseLifetime = createRequestLifetime(timeoutMs, input.signal);
  // Load tracking must span the whole attempt, including streamed bodies, so
  // release is tied to the same cleanup/abort pair that owns the lifetime.
  const releaseLoad = beginCredentialUse(input.candidate.credentialId);
  const lifetime: RequestLifetime = {
    signal: baseLifetime.signal,
    didTimeout: baseLifetime.didTimeout,
    cleanup: () => {
      releaseLoad();
      baseLifetime.cleanup();
    },
    abort: (reason?: unknown) => {
      releaseLoad();
      baseLifetime.abort(reason);
    },
  };

  const result = (
    partial: Omit<RelayUpstreamAttemptResult, "latencyMs" | "cleanup" | "abort">,
  ): RelayUpstreamAttemptResult => ({
    ...partial,
    latencyMs: Date.now() - startedAt,
    cleanup: lifetime.cleanup,
    abort: lifetime.abort,
  });

  let url: URL;
  let headers: Headers;
  let serializedBody: string | undefined;
  const protocol = input.protocol ?? input.candidate.upstreamProtocol ?? DEFAULT_RELAY_PROTOCOL;
  const supportedProtocols = input.candidate.supportedProtocols ?? [];
  const method = input.method ?? (input.operation === "models" ? "GET" : "POST");
  try {
    if (!supportedProtocols.includes(protocol)) {
      throw new Error(`上游凭证不支持协议：${protocol}`);
    }
    const secret = decryptSecret(input.candidate.secretEncrypted);
    url = buildRelayUpstreamUrl(input.candidate.baseUrl, protocol, input.operation);
    for (const [name, value] of Object.entries(input.query ?? {})) {
      if (
        !/^[a-z0-9_.-]{1,64}$/i.test(name) ||
        value.length > 1_024 ||
        /[\r\n]/.test(value)
      ) {
        throw new Error(`无效的上游查询参数：${name}`);
      }
      url.searchParams.set(name, value);
    }
    headers = buildRelayUpstreamHeaders({
      protocol,
      authStyle: input.candidate.authStyle,
      secret,
      forwardHeaders: input.forwardHeaders,
      requestId: input.requestId,
    });
    if (method !== "GET") {
      serializedBody = JSON.stringify({
        ...(input.body ?? {}),
        model: input.candidate.upstreamModel,
      });
    }
  } catch (error) {
    lifetime.cleanup();
    return result({
      response: null,
      kind: "configuration_error",
      retryable: true,
      status: null,
      errorCode: "upstream_configuration_error",
      errorMessage: error instanceof Error ? error.message : "上游配置无效",
    });
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: serializedBody,
      redirect: "manual",
      signal: lifetime.signal,
    });
  } catch (error) {
    const externalCancelled = Boolean(input.signal?.aborted) && !lifetime.didTimeout();
    const kind: RelayUpstreamAttemptKind = lifetime.didTimeout()
      ? "timeout"
      : externalCancelled
        ? "cancelled"
        : "network_error";
    const message = lifetime.didTimeout()
      ? `上游请求超时（${timeoutMs}ms）`
      : externalCancelled
        ? "客户端已取消请求"
        : describeFetchError(error);

    try {
      if (kind !== "cancelled") {
        await markCredentialFailure(input.candidate, message);
      }
    } finally {
      lifetime.cleanup();
    }
    return result({
      response: null,
      kind,
      retryable: kind !== "cancelled",
      status: null,
      errorCode: kind === "timeout"
        ? "upstream_timeout"
        : kind === "cancelled"
          ? "request_cancelled"
          : "upstream_network_error",
      errorMessage: message,
    });
  }

  const classification = classifyHttpStatus(response.status);
  try {
    if (classification.kind === "success") {
      await markCredentialSuccess(input.candidate);
    } else if (classification.kind === "auth_error") {
      await autoDisableCredential(input.candidate, response.status);
    } else if (classification.kind === "rate_limited") {
      await coolCredential(input.candidate, cooldownSeconds);
    } else if (response.status >= 500 && response.status <= 599) {
      await markCredentialFailure(
        input.candidate,
        classification.errorMessage ?? `HTTP ${response.status}`,
      );
    } else {
      await markCredentialUsed(input.candidate);
    }
  } catch (error) {
    // Do not leave a live upstream body or timeout behind when durable health state cannot update.
    lifetime.abort(error);
    throw error;
  }

  return result({
    response,
    kind: classification.kind,
    retryable: classification.retryable,
    status: response.status,
    errorCode: classification.errorCode,
    errorMessage: classification.errorMessage,
  });
}

/** Preserve the original Chat Completions API for existing routes and callers. */
export function sendRelayUpstreamChat(
  input: SendRelayUpstreamChatInput,
): Promise<RelayUpstreamAttemptResult> {
  return sendRelayUpstream({
    ...input,
    protocol: DEFAULT_RELAY_PROTOCOL,
    operation: "chat_completions",
  });
}
