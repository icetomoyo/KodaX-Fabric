import { and, eq, sql } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import { upstreamCredentials } from "../../db/schema/index.js";
import { decryptSecret } from "../crypto-secret.js";
import {
  extractUpstreamUsageCap,
  type UpstreamUsageCap,
} from "../glm-error-codes.js";
import {
  externalDrainObservation,
  fiveHourResetAt,
  getCredentialQuotaUsage,
  learnedCapResetFromMeta,
  learnedNextReset,
  mergeLearnedCapReset,
  weeklyResetAt,
  type LearnedCapResets,
} from "./credential-quota.js";
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
  virtualKeyId?: number;
};

export type RelayUpstreamOperation =
  | "models"
  | "chat_completions"
  | "responses"
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
  virtualKeyId?: number;
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
  openai_responses: {
    models: "models",
    responses: "responses",
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

const RATE_LIMIT_LAST_ERROR = "HTTP 429：上游限流，凭证已进入冷却";
const QUOTA_EXHAUSTED_LAST_ERROR = "HTTP 429：上游余额不足，凭证已长时间冷却";
const USAGE_CAP_LAST_ERROR = "HTTP 429：上游使用已达上限，凭证冷却至窗口重置";

/** Never trust an upstream-provided reset time further out than this. */
const MAX_USAGE_CAP_COOLDOWN_MS = 31 * 24 * 3_600_000;

export type RelayRateLimitCooldownDecision = {
  cooldownSeconds: number;
  /** Absolute cooling end when the upstream told us the reset instant. */
  coolUntil: Date | null;
  lastError: string;
  quotaExhausted: boolean;
  /** 识别出的配额上限信号；普通限流/非 JSON 报文为 null。 */
  cap: UpstreamUsageCap | null;
};

function parseJsonValue(text: string): unknown | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * End of cooling for a usage cap that still has a future window.
 * A timestamp already in the past is handled by the caller (short cooldown);
 * this helper must not roll learned / local windows forward in that case.
 * Balance errors (欠费/余额不足) have no time window and return null.
 */
function usageCapResetAt(
  cap: UpstreamUsageCap,
  now: Date,
  learned?: LearnedCapResets | null,
): Date | null {
  if (cap.resetAt) {
    if (cap.resetAt.getTime() > now.getTime()) {
      return new Date(
        Math.min(cap.resetAt.getTime(), now.getTime() + MAX_USAGE_CAP_COOLDOWN_MS),
      );
    }
    return null;
  }
  // 报文没带时刻时，先回退到该 Key 此前学到的同窗口相位。
  const learnedReset = learnedNextReset(learned ?? null, cap.kind, now);
  if (learnedReset) {
    return new Date(
      Math.min(learnedReset.getTime(), now.getTime() + MAX_USAGE_CAP_COOLDOWN_MS),
    );
  }
  if (cap.kind === "five_hour") return fiveHourResetAt(now);
  // monthly has no dedicated Hub window; reuse the 7-day boundary as a
  // conservative bound. Live monthly replies so far always include resetAt.
  if (cap.kind === "weekly" || cap.kind === "monthly") return weeklyResetAt(now);
  return null;
}

/** Decide 429 cooldown from a peeked body; unread/non-JSON bodies stay on the short cooldown. */
export function resolveRelayRateLimitCooldown(
  bodyText: string | null,
  defaultCooldownSeconds: number,
  quotaCooldownSeconds: number,
  now: Date = new Date(),
  learned?: LearnedCapResets | null,
): RelayRateLimitCooldownDecision {
  if (bodyText) {
    const parsed = parseJsonValue(bodyText);
    const cap = parsed === undefined ? null : extractUpstreamUsageCap(parsed);
    if (cap) {
      // 报文带了恢复时刻但已过期：窗口已开，或 429 跨过了重置点。
      // 15:32:01 的 429 在 15:32:03 才落到 Hub 时，前滚 learned/本地窗口
      // 会再冷 5 小时（周额度则可能几天），所以只走普通短冷却。
      if (cap.resetAt && cap.resetAt.getTime() <= now.getTime()) {
        return {
          cooldownSeconds: defaultCooldownSeconds,
          coolUntil: null,
          lastError: RATE_LIMIT_LAST_ERROR,
          quotaExhausted: false,
          cap,
        };
      }
      const resetAt = usageCapResetAt(cap, now, learned);
      if (resetAt) {
        return {
          cooldownSeconds: Math.max(
            1,
            Math.ceil((resetAt.getTime() - now.getTime()) / 1_000),
          ),
          coolUntil: resetAt,
          lastError: USAGE_CAP_LAST_ERROR,
          quotaExhausted: true,
          cap,
        };
      }
      return {
        cooldownSeconds: quotaCooldownSeconds,
        coolUntil: null,
        lastError: QUOTA_EXHAUSTED_LAST_ERROR,
        quotaExhausted: true,
        cap,
      };
    }
  }
  return {
    cooldownSeconds: defaultCooldownSeconds,
    coolUntil: null,
    lastError: RATE_LIMIT_LAST_ERROR,
    quotaExhausted: false,
    cap: null,
  };
}

async function peekResponseText(response: Response): Promise<string | null> {
  try {
    return await response.clone().text();
  } catch {
    return null;
  }
}

/**
 * 429 配额信号带来的 meta 增量：学到的该 Key 窗口重置相位
 * （learnedCapReset）与站外消耗证据（externalDrain）。没有可写内容时返回
 * null，调用方据此完全不碰 meta 列。
 */
async function usageCapMetaPatch(
  candidate: RelayCandidate,
  cap: UpstreamUsageCap | null,
  now: Date,
): Promise<Record<string, unknown> | null> {
  if (!cap) return null;
  // Stale 429: the quoted reset already passed. Do not persist it as a
  // learned phase (that would roll the next window forward) or as drain evidence.
  if (cap.resetAt && cap.resetAt.getTime() <= now.getTime()) return null;
  const patch: Record<string, unknown> = {};
  if (cap.resetAt) {
    const merged = mergeLearnedCapReset(candidate.meta, cap.kind, cap.resetAt);
    if (merged.learnedCapReset) patch.learnedCapReset = merged.learnedCapReset;
  }
  // 本地账本远低于限额时 429 说明 Key 在站外被直接消耗，留下证据。
  const limit = cap.kind === "five_hour"
    ? (candidate.fiveHourCreditLimit ?? null)
    : cap.kind === "weekly"
      ? (candidate.weeklyCreditLimit ?? null)
      : null;
  if (limit != null) {
    const usage = await getCredentialQuotaUsage([candidate.credentialId], now);
    const local = usage.get(candidate.credentialId);
    const localCredits = cap.kind === "five_hour"
      ? (local?.fiveHourCredits ?? 0)
      : (local?.weeklyCredits ?? 0);
    const observation = externalDrainObservation({
      kind: cap.kind,
      localCredits,
      limit,
      now,
    });
    if (observation) patch.externalDrain = observation;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

async function coolCredential(
  candidate: RelayCandidate,
  cooldownSeconds: number,
  lastError: string,
  explicitCoolUntil?: Date | null,
  metaPatch?: Record<string, unknown> | null,
): Promise<void> {
  const now = new Date();
  const coolUntil =
    explicitCoolUntil ?? new Date(now.getTime() + cooldownSeconds * 1_000);
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
      lastError: lastError.slice(0, 1_000),
      lastErrorAt: now,
      lastUsedAt: now,
      updatedAt: now,
      // 有配额观测时才合并 meta；普通 429 完全不写这一列。
      ...(metaPatch
        ? {
            meta: sql`coalesce(${upstreamCredentials.meta}, '{}'::jsonb) || ${JSON.stringify(metaPatch)}::jsonb`,
          }
        : {}),
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
  const releaseLoad = beginCredentialUse(
    input.candidate.credentialId,
    input.virtualKeyId,
  );
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
      const bodyText = await peekResponseText(response);
      const now = new Date();
      const decision = resolveRelayRateLimitCooldown(
        bodyText,
        cooldownSeconds,
        env.RELAY_QUOTA_COOLDOWN_SECONDS,
        now,
        learnedCapResetFromMeta(input.candidate.meta),
      );
      const metaPatch = await usageCapMetaPatch(input.candidate, decision.cap, now);
      await coolCredential(
        input.candidate,
        decision.cooldownSeconds,
        decision.lastError,
        decision.coolUntil,
        metaPatch,
      );
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
