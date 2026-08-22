import { randomUUID } from "node:crypto";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import { env } from "../../config.js";
import {
  emptyRelayUsage,
  parseRelayUsage,
  sanitizeRelayRequestHeaders,
  writeRelayAudit,
  type RelayAuditInput,
} from "../../lib/relay/audit.js";
import { createNativeSsePassthrough } from "../../lib/relay/native-sse.js";
import {
  RELAY_ENDPOINTS,
  type RelayProtocol,
} from "../../lib/relay/protocol.js";
import {
  acquireRelayQuota,
  RelayLimitError,
  type RelayQuotaLease,
} from "../../lib/relay/quota.js";
import { resolveRelayCandidates } from "../../lib/relay/routing.js";
import type {
  RelayCandidate,
  RelayRetryTraceItem,
} from "../../lib/relay/types.js";
import {
  sendRelayUpstream,
  type RelayUpstreamAttemptKind,
  type RelayUpstreamAttemptResult,
  type RelayUpstreamOperation,
} from "../../lib/relay/upstream.js";
import { createRequireRelayApiKey } from "../../middleware/api-key.js";
import {
  RelayResponseTooLargeError,
  readBoundedBody,
  readFirstNonEmptyChunk,
  settleFailedAttempt,
  toFastifyReadable,
} from "./chat-completions.js";

type NativeProtocol = Extract<RelayProtocol, "anthropic_messages">;
type JsonObject = Record<string, unknown>;
type NativeRequestBody = JsonObject & {
  model: string;
  stream?: boolean;
};

type NativeRouteConfig = {
  path:
    | typeof RELAY_ENDPOINTS.messages
    | typeof RELAY_ENDPOINTS.messagesCountTokens;
  protocol: NativeProtocol;
  operation: Extract<
    RelayUpstreamOperation,
    "messages" | "messages_count_tokens"
  >;
  schema: z.ZodType;
  validationMessage: string;
  supportsStream: boolean;
  requiresAnthropicVersion: boolean;
};

const messagesSchema = z
  .object({
    model: z.string().trim().min(1).max(128),
    messages: z.array(z.unknown()).min(1),
    max_tokens: z.number().int().nonnegative(),
    stream: z.boolean().optional().default(false),
  })
  .passthrough();

const messagesCountTokensSchema = z
  .object({
    model: z.string().trim().min(1).max(128),
    messages: z.array(z.unknown()).min(1),
  })
  .passthrough();

const routeConfigs: NativeRouteConfig[] = [
  {
    path: RELAY_ENDPOINTS.messages,
    protocol: "anthropic_messages",
    operation: "messages",
    schema: messagesSchema,
    validationMessage: "请求参数无效：model、messages 和 max_tokens 为必填项",
    supportsStream: true,
    requiresAnthropicVersion: true,
  },
  {
    path: RELAY_ENDPOINTS.messagesCountTokens,
    protocol: "anthropic_messages",
    operation: "messages_count_tokens",
    schema: messagesCountTokensSchema,
    validationMessage: "请求参数无效：model 和 messages 为必填项",
    supportsStream: false,
    requiresAnthropicVersion: true,
  },
];

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(raw: Buffer): unknown | null {
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
}

function auditBody(raw: Buffer, parsed: unknown, contentType: string | null): unknown {
  if (parsed !== null) return parsed;
  return { contentType, raw: raw.toString("utf8") };
}

function safeContentType(response: Response): string {
  const contentType = response.headers.get("content-type");
  if (!contentType || /[\r\n]/.test(contentType)) {
    return "application/json; charset=utf-8";
  }
  return contentType;
}

function safeHeaderValue(value: string | null): value is string {
  return Boolean(value) && value!.length <= 8_192 && !/[\r\n]/.test(value!);
}

function copyUpstreamResponseHeaders(reply: FastifyReply, response: Response): void {
  for (const [name, value] of response.headers) {
    const normalized = name.toLowerCase();
    const allowed = normalized === "retry-after" ||
      normalized.startsWith("x-ratelimit-") ||
      normalized.startsWith("anthropic-ratelimit-") ||
      normalized.startsWith("anthropic-priority-") ||
      normalized.startsWith("anthropic-fast-");
    if (allowed && safeHeaderValue(value)) reply.header(normalized, value);
  }

  const anthropicRequestId = response.headers.get("request-id");
  if (safeHeaderValue(anthropicRequestId)) {
    reply.header("request-id", anthropicRequestId);
  }
  const upstreamRequestId = anthropicRequestId ?? response.headers.get("x-request-id");
  if (safeHeaderValue(upstreamRequestId)) {
    reply.header("x-tokenhub-upstream-request-id", upstreamRequestId);
  }
}

function headerValue(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value) && value.length === 1) return value[0]?.trim() || null;
  return null;
}

function anthropicQuery(req: FastifyRequest): Record<string, string> | undefined {
  if (!isJsonObject(req.query)) return undefined;
  const beta = req.query.beta;
  if (beta !== "true" && beta !== "false") return undefined;
  return { beta };
}

function nativeError(
  requestId: string,
  message: string,
  type: string,
  code: string,
): JsonObject {
  return {
    type: "error",
    error: { type, message, code },
    request_id: requestId,
  };
}

function isNativeErrorPayload(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return value.type === "error" && isJsonObject(value.error);
}

function originalModel(body: unknown): string {
  if (!isJsonObject(body) || typeof body.model !== "string") return "(invalid)";
  return body.model.slice(0, 128) || "(invalid)";
}

function requestUserAgent(req: FastifyRequest): string | undefined {
  const value = req.headers["user-agent"];
  return Array.isArray(value) ? value.join(", ") : value;
}

function traceItem(
  attempt: number,
  candidate: RelayCandidate,
  result: RelayUpstreamAttemptResult,
  outcome: RelayRetryTraceItem["outcome"],
  reason?: string,
): RelayRetryTraceItem {
  return {
    attempt,
    providerCode: candidate.providerCode,
    productLineId: candidate.productLineId,
    credentialId: candidate.credentialId,
    credentialSuffix: candidate.credentialSuffix,
    status: result.status,
    latencyMs: result.latencyMs,
    outcome,
    ...(reason ? { reason: reason.slice(0, 300) } : {}),
  };
}

function downstreamFailure(kind: RelayUpstreamAttemptKind): {
  status: number;
  type: string;
  code: string;
  message: string;
} {
  switch (kind) {
    case "rate_limited":
      return {
        status: 429,
        type: "rate_limit_error",
        code: "upstream_rate_limited",
        message: "上游渠道繁忙，请稍后重试",
      };
    case "timeout":
      return {
        status: 504,
        type: "timeout_error",
        code: "upstream_timeout",
        message: "上游响应超时",
      };
    case "auth_error":
      return {
        status: 502,
        type: "api_error",
        code: "upstream_authentication_failed",
        message: "可用上游凭证鉴权失败",
      };
    case "cancelled":
      return {
        status: 499,
        type: "api_error",
        code: "request_cancelled",
        message: "请求已取消",
      };
    case "configuration_error":
      return {
        status: 503,
        type: "api_error",
        code: "upstream_configuration_error",
        message: "上游渠道配置不可用",
      };
    case "network_error":
      return {
        status: 502,
        type: "api_error",
        code: "upstream_network_error",
        message: "无法连接上游服务",
      };
    default:
      return {
        status: 502,
        type: "api_error",
        code: "upstream_unavailable",
        message: "上游服务暂时不可用",
      };
  }
}

async function discardResponse(response: Response | null): Promise<void> {
  if (!response?.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Best effort; aborting the attempt is the lifecycle fallback.
  }
}

async function releaseQuota(
  app: FastifyInstance,
  requestId: string,
  lease: RelayQuotaLease | null,
): Promise<void> {
  if (!lease) return;
  try {
    await lease.release();
  } catch (error) {
    app.log.error({ err: error, requestId }, "failed to release native relay quota lease");
  }
}

async function persistAudit(app: FastifyInstance, input: RelayAuditInput): Promise<void> {
  try {
    await writeRelayAudit(input);
  } catch (error) {
    app.log.error({ err: error, requestId: input.requestId }, "failed to write native relay audit");
  }
}

type FinalizeAuditInput = Omit<
  RelayAuditInput,
  | "requestId"
  | "principal"
  | "protocol"
  | "clientModel"
  | "isStream"
  | "latencyMs"
  | "retryTrace"
  | "requestHeaders"
  | "requestBody"
  | "clientIp"
  | "userAgent"
  | "requestPath"
  | "ttftMs"
  | "generationMs"
>;

async function handleNativeRequest(
  app: FastifyInstance,
  config: NativeRouteConfig,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const startedAt = Date.now();
  const requestId = `threq_${randomUUID().replaceAll("-", "")}`;
  const principal = req.relayPrincipal!;
  const requestHeaders = sanitizeRelayRequestHeaders(req);
  const requestBody = req.body;
  const parsed = config.schema.safeParse(requestBody);
  const clientModel = parsed.success ? originalModel(parsed.data) : originalModel(requestBody);
  const parsedObject = parsed.success && isJsonObject(parsed.data) ? parsed.data : null;
  const isStream = Boolean(config.supportsStream && parsedObject?.stream === true);
  const retryTrace: RelayRetryTraceItem[] = [];
  let lease: RelayQuotaLease | null = null;
  let activeAttempt: RelayUpstreamAttemptResult | null = null;
  let currentCandidate: RelayCandidate | null = null;
  let streamHandedOff = false;
  let auditWritten = false;

  reply.header("x-tokenhub-request-id", requestId);
  reply.header("request-id", requestId);

  const finalizeAudit = async (
    input: FinalizeAuditInput,
    timing?: { ttftMs?: number | null; generationMs?: number | null },
  ) => {
    if (auditWritten) return;
    auditWritten = true;
    await persistAudit(app, {
      ...input,
      requestId,
      principal,
      protocol: config.protocol,
      clientModel,
      isStream,
      latencyMs: Date.now() - startedAt,
      ttftMs: timing?.ttftMs,
      generationMs: timing?.generationMs,
      retryTrace,
      requestHeaders,
      requestBody,
      clientIp: req.ip,
      userAgent: requestUserAgent(req),
      requestPath: req.url,
    });
  };

  const sendError = (
    status: number,
    message: string,
    type: string,
    code: string,
  ) => nativeError(requestId, message, type, code);

  try {
    const anthropicVersion = headerValue(req, "anthropic-version");
    if (!parsed.success || (config.requiresAnthropicVersion && !anthropicVersion)) {
      const errorMessage = config.requiresAnthropicVersion && !anthropicVersion
        ? "缺少必需请求头 anthropic-version"
        : config.validationMessage;
      const payload = sendError(400, errorMessage, "invalid_request_error", "invalid_request");
      await finalizeAudit({
        candidate: null,
        status: "client_error",
        httpStatus: 400,
        upstreamStatus: null,
        errorCode: "invalid_request",
        errorMessage: parsed.success
          ? errorMessage
          : (parsed.error.issues[0]?.message ?? errorMessage),
        usage: emptyRelayUsage(),
        responseBody: payload,
      });
      return reply.code(400).send(payload);
    }

    const body = {
      ...(parsed.data as JsonObject),
      stream: config.supportsStream ? isStream : undefined,
    } as NativeRequestBody;
    if (!config.supportsStream) delete body.stream;

    try {
      lease = await acquireRelayQuota(principal.employeeId);
    } catch (error) {
      if (!(error instanceof RelayLimitError)) throw error;
      const httpStatus = error.code === "enterprise_required" ? 403 : 429;
      const payload = sendError(
        httpStatus,
        error.message,
        error.code === "enterprise_required" ? "permission_error" : "rate_limit_error",
        error.code,
      );
      if (error.retryAfterSeconds) reply.header("retry-after", String(error.retryAfterSeconds));
      await finalizeAudit({
        candidate: null,
        status: "client_error",
        httpStatus,
        upstreamStatus: null,
        errorCode: error.code,
        errorMessage: error.message,
        usage: emptyRelayUsage(),
        responseBody: payload,
      });
      return reply.code(httpStatus).send(payload);
    }

    const resolution = await resolveRelayCandidates(
      principal.employeeId,
      body.model,
      config.protocol,
      principal.productLineId,
    );
    const candidates = resolution.candidates;
    if (candidates.length === 0) {
      const boundUnavailable = resolution.unavailableReason === "bound_channel_unavailable";
      const cooling = resolution.unavailableReason === "cooling";
      const unavailable = resolution.unavailableReason === "unavailable";
      const httpStatus = boundUnavailable || unavailable
        ? 503
        : cooling
          ? 429
          : 404;
      const errorCode = boundUnavailable
        ? "bound_channel_unavailable"
        : cooling
          ? "model_channels_cooling"
          : unavailable
            ? "model_unavailable"
            : "model_not_found";
      const errorMessage = boundUnavailable
        ? "当前 Key 绑定的上游渠道不可用"
        : cooling
          ? "该模型的上游渠道正在冷却，请稍后重试"
          : unavailable
            ? "该模型已配置，但当前没有支持此协议的可用上游渠道"
            : "当前 Key 绑定的上游渠道不支持该模型和协议";
      const errorType = boundUnavailable || unavailable
        ? "api_error"
        : cooling
          ? "rate_limit_error"
          : "not_found_error";
      const payload = sendError(
        httpStatus,
        errorMessage,
        errorType,
        errorCode,
      );
      if (resolution.retryAfterSeconds !== null) {
        reply.header("retry-after", String(resolution.retryAfterSeconds));
      }
      await finalizeAudit({
        candidate: null,
        status: boundUnavailable || cooling || unavailable
          ? "upstream_error"
          : "client_error",
        httpStatus,
        upstreamStatus: null,
        errorCode,
        errorMessage,
        usage: emptyRelayUsage(),
        responseBody: payload,
      });
      return reply.code(httpStatus).send(payload);
    }

    const attempts = candidates.slice(0, env.RELAY_MAX_ATTEMPTS);
    let lastCandidate: RelayCandidate | null = null;
    let lastFailure: RelayUpstreamAttemptResult | null = null;

    for (let index = 0; index < attempts.length; index += 1) {
      const candidate = attempts[index];
      currentCandidate = candidate;
      lastCandidate = candidate;
      const hasNext = index + 1 < attempts.length;
      const result = await sendRelayUpstream({
        candidate,
        protocol: config.protocol,
        operation: config.operation,
        body,
        query: anthropicQuery(req),
        forwardHeaders: req.headers,
        requestId,
        signal: req.signal,
      });
      activeAttempt = result;

      if (result.kind !== "success" || !result.response) {
        const willRetry = result.retryable && hasNext && !req.signal.aborted;
        retryTrace.push(
          traceItem(
            index + 1,
            candidate,
            result,
            willRetry
              ? "retry"
              : result.kind === "network_error"
                ? "network_error"
                : "failed",
            result.errorCode ?? undefined,
          ),
        );
        lastFailure = result;
        const disposition = await settleFailedAttempt(result, willRetry);
        if (disposition === "released") activeAttempt = null;
        if (willRetry) continue;
        break;
      }

      const response = result.response;
      if (!isStream) {
        let raw: Buffer;
        try {
          raw = await readBoundedBody(response, env.RELAY_RESPONSE_MAX_BYTES);
        } catch (error) {
          const willRetry = !(error instanceof RelayResponseTooLargeError) &&
            hasNext &&
            !req.signal.aborted;
          retryTrace.push(
            traceItem(
              index + 1,
              candidate,
              result,
              willRetry ? "retry" : "failed",
              error instanceof RelayResponseTooLargeError
                ? "upstream_response_too_large"
                : "upstream_body_error",
            ),
          );
          result.abort(error);
          activeAttempt = null;
          if (willRetry) continue;
          lastFailure = {
            ...result,
            response: null,
            kind: error instanceof RelayResponseTooLargeError
              ? "upstream_error"
              : req.signal.aborted
                ? "cancelled"
                : "network_error",
            retryable: false,
            errorCode: error instanceof RelayResponseTooLargeError
              ? "upstream_response_too_large"
              : "upstream_body_error",
            errorMessage: error instanceof Error ? error.message : "上游响应读取失败",
          };
          break;
        }

        if (raw.length === 0) {
          const willRetry = hasNext && !req.signal.aborted;
          retryTrace.push(
            traceItem(
              index + 1,
              candidate,
              result,
              willRetry ? "retry" : "failed",
              "upstream_empty_response",
            ),
          );
          result.cleanup();
          activeAttempt = null;
          if (willRetry) continue;
          lastFailure = {
            ...result,
            response: null,
            kind: "upstream_error",
            retryable: false,
            errorCode: "upstream_empty_response",
            errorMessage: "上游返回了空响应",
          };
          break;
        }

        const responseJson = parseJson(raw);
        const usage = config.operation !== "messages_count_tokens" && isJsonObject(responseJson)
          ? parseRelayUsage(responseJson.usage)
          : emptyRelayUsage();
        retryTrace.push(traceItem(index + 1, candidate, result, "success"));
        result.cleanup();
        activeAttempt = null;
        await finalizeAudit({
          candidate,
          status: "success",
          httpStatus: response.status,
          upstreamStatus: response.status,
          errorCode: null,
          errorMessage: null,
          usage,
          responseBody: auditBody(raw, responseJson, response.headers.get("content-type")),
        });
        copyUpstreamResponseHeaders(reply, response);
        reply.type(safeContentType(response));
        return reply.code(response.status).send(raw);
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/event-stream") || !response.body) {
        const willRetry = hasNext && !req.signal.aborted;
        retryTrace.push(
          traceItem(
            index + 1,
            candidate,
            result,
            willRetry ? "retry" : "failed",
            "upstream_invalid_stream",
          ),
        );
        await discardResponse(response);
        result.cleanup();
        activeAttempt = null;
        if (willRetry) continue;
        lastFailure = {
          ...result,
          response: null,
          kind: "upstream_error",
          retryable: false,
          errorCode: "upstream_invalid_stream",
          errorMessage: "上游未返回 SSE 流",
        };
        break;
      }

      const reader = response.body.getReader();
      let firstChunk: ReadableStreamReadResult<Uint8Array>;
      try {
        firstChunk = await readFirstNonEmptyChunk(reader);
      } catch (error) {
        const willRetry = hasNext && !req.signal.aborted;
        retryTrace.push(
          traceItem(
            index + 1,
            candidate,
            result,
            willRetry ? "retry" : "failed",
            "upstream_first_byte_error",
          ),
        );
        try {
          await reader.cancel(error);
        } catch {
          // Reader may already be closed.
        }
        result.abort(error);
        activeAttempt = null;
        if (willRetry) continue;
        lastFailure = {
          ...result,
          response: null,
          kind: req.signal.aborted ? "cancelled" : "network_error",
          retryable: false,
          errorCode: "upstream_first_byte_error",
          errorMessage: "上游首包读取失败",
        };
        break;
      }

      if (firstChunk.done) {
        const willRetry = hasNext && !req.signal.aborted;
        retryTrace.push(
          traceItem(
            index + 1,
            candidate,
            result,
            willRetry ? "retry" : "failed",
            "upstream_empty_stream",
          ),
        );
        result.cleanup();
        activeAttempt = null;
        if (willRetry) continue;
        lastFailure = {
          ...result,
          response: null,
          kind: "upstream_error",
          retryable: false,
          errorCode: "upstream_empty_stream",
          errorMessage: "上游返回了空流",
        };
        break;
      }

      const streamTrace = traceItem(index + 1, candidate, result, "success");
      retryTrace.push(streamTrace);
      const passthrough = createNativeSsePassthrough(reader, {
        protocol: config.protocol,
        initialChunks: [firstChunk.value],
        maxAuditBytes: env.AUDIT_BODY_MAX_BYTES,
      });

      const cancelDownstream = () => {
        if (!reply.raw.writableFinished) {
          void passthrough.cancel(new Error("downstream connection closed"));
        }
      };
      const cancelRequest = () => void passthrough.cancel(req.signal.reason);
      if (reply.raw.destroyed) {
        void passthrough.cancel(new Error("downstream connection already closed"));
      } else {
        reply.raw.once("close", cancelDownstream);
      }
      if (req.signal.aborted) {
        void passthrough.cancel(req.signal.reason);
      } else {
        req.signal.addEventListener("abort", cancelRequest, { once: true });
      }

      let streamHandoffError: unknown = null;
      const streamFinalization = passthrough.completion.then(async (completion) => {
        reply.raw.off("close", cancelDownstream);
        req.signal.removeEventListener("abort", cancelRequest);
        result.cleanup();
        await releaseQuota(app, requestId, lease);

        const handoffFailed = streamHandoffError !== null;
        const protocolCompleted = completion.audit.upstreamError === null &&
          completion.audit.terminalKind === "completed";
        const cancelled = !handoffFailed &&
          !protocolCompleted &&
          completion.state === "cancelled";
        const streamFailed = handoffFailed ||
          (!protocolCompleted &&
            (completion.state === "errored" ||
              completion.audit.upstreamError !== null ||
              !completion.audit.terminalSeen));
        const status = cancelled
          ? "cancelled"
          : streamFailed
            ? "upstream_error"
            : "success";
        if (cancelled || streamFailed) {
          streamTrace.outcome = "failed";
          streamTrace.reason = cancelled
            ? "request_cancelled"
            : handoffFailed
              ? "downstream_stream_handoff_error"
              : completion.audit.upstreamError !== null
                ? "upstream_stream_error_event"
                : !completion.audit.terminalSeen
                  ? "upstream_stream_missing_terminal"
                  : "upstream_stream_error";
        }
        const firstTokenAt = completion.audit.firstTokenAt;
        const streamEndAt = Date.now();
        const ttftMs = firstTokenAt !== null ? firstTokenAt - startedAt : null;
        const generationMs = firstTokenAt !== null ? streamEndAt - firstTokenAt : null;
        await finalizeAudit(
          {
            candidate,
            status,
            httpStatus: handoffFailed ? 500 : cancelled ? 499 : response.status,
            upstreamStatus: response.status,
            errorCode: cancelled
              ? "request_cancelled"
              : handoffFailed
                ? "downstream_stream_handoff_error"
                : streamFailed
                  ? "upstream_stream_error"
                  : null,
            errorMessage: cancelled
              ? "客户端取消了流式请求"
              : handoffFailed
                ? "网关无法向客户端发送流式响应"
                : streamFailed
                  ? "上游流式响应中断或返回错误事件"
                  : null,
            usage: completion.audit.usage,
            responseBody: {
              stream: true,
              protocol: config.protocol,
              state: completion.state,
              bytesSeen: completion.audit.bytesSeen,
              auditBytesCaptured: completion.audit.auditBytesCaptured,
              truncated: completion.audit.truncated,
              terminalSeen: completion.audit.terminalSeen,
              terminalEvent: completion.audit.terminalEvent,
              terminalKind: completion.audit.terminalKind,
              eventCount: completion.audit.eventCount,
              malformedEventCount: completion.audit.malformedEventCount,
              oversizedEventCount: completion.audit.oversizedEventCount,
              assembled: completion.audit.assembled,
              upstreamError: completion.audit.upstreamError,
            },
          },
          { ttftMs, generationMs },
        );
      }).catch((error) => {
        app.log.error({ err: error, requestId }, "failed to finalize native relay stream");
      });

      copyUpstreamResponseHeaders(reply, response);
      reply.headers({
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      });
      reply.code(response.status);
      streamHandedOff = true;
      activeAttempt = null;
      try {
        reply.send(toFastifyReadable(passthrough.stream));
        return reply;
      } catch (error) {
        streamHandoffError = error;
        await passthrough.cancel(error);
        await streamFinalization;
        throw error;
      }
    }

    const failure = lastFailure;
    const candidate = lastCandidate;
    let terminalResponseConsumed = false;
    if (
      failure?.response &&
      (failure.kind === "client_error" ||
        failure.kind === "rate_limited" ||
        failure.kind === "upstream_error")
    ) {
      const upstreamResponse = failure.response;
      let raw: Buffer = Buffer.alloc(0);
      try {
        raw = await readBoundedBody(
          upstreamResponse,
          Math.min(env.AUDIT_BODY_MAX_BYTES, 1024 * 1024),
        );
      } catch {
        failure.abort();
      } finally {
        failure.cleanup();
        activeAttempt = null;
        terminalResponseConsumed = true;
      }
      const responseJson = parseJson(raw);
      const status = failure.status ?? (failure.kind === "client_error" ? 400 : 502);
      if (isNativeErrorPayload(responseJson)) {
        await finalizeAudit({
          candidate,
          status: failure.kind === "client_error" ? "client_error" : "upstream_error",
          httpStatus: status,
          upstreamStatus: failure.status,
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
          usage: emptyRelayUsage(),
          responseBody: responseJson,
        });
        copyUpstreamResponseHeaders(reply, upstreamResponse);
        reply.type(safeContentType(upstreamResponse));
        return reply.code(status).send(raw);
      }

      if (failure.kind === "client_error") {
        const payload = sendError(
          status,
          failure.errorMessage ?? "上游拒绝了请求参数",
          "invalid_request_error",
          failure.errorCode ?? "upstream_client_error",
        );
        await finalizeAudit({
          candidate,
          status: "client_error",
          httpStatus: status,
          upstreamStatus: failure.status,
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
          usage: emptyRelayUsage(),
          responseBody: payload,
        });
        copyUpstreamResponseHeaders(reply, upstreamResponse);
        return reply.code(status).send(payload);
      }
    }

    if (failure?.response && !terminalResponseConsumed) {
      await discardResponse(failure.response);
      failure.cleanup();
      activeAttempt = null;
    }
    const mapped = downstreamFailure(failure?.kind ?? "upstream_error");
    const payload = sendError(mapped.status, mapped.message, mapped.type, mapped.code);
    if (mapped.status === 429) reply.header("retry-after", String(env.RELAY_COOLDOWN_SECONDS));
    await finalizeAudit({
      candidate,
      status: failure?.kind === "cancelled" ? "cancelled" : "upstream_error",
      httpStatus: mapped.status,
      upstreamStatus: failure?.status ?? null,
      errorCode: failure?.errorCode ?? mapped.code,
      errorMessage: failure?.errorMessage ?? mapped.message,
      usage: emptyRelayUsage(),
      responseBody: payload,
    });
    return reply.code(mapped.status).send(payload);
  } catch (error) {
    activeAttempt?.abort(error);
    activeAttempt = null;
    const cancelled = req.signal.aborted;
    const payload = cancelled
      ? sendError(499, "请求已取消", "api_error", "request_cancelled")
      : sendError(
          500,
          "TokenHub 处理请求时发生内部错误",
          "api_error",
          "relay_internal_error",
        );
    await finalizeAudit({
      candidate: currentCandidate,
      status: cancelled ? "cancelled" : "upstream_error",
      httpStatus: cancelled ? 499 : 500,
      upstreamStatus: null,
      errorCode: cancelled ? "request_cancelled" : "relay_internal_error",
      errorMessage: error instanceof Error ? error.message : "网关内部错误",
      usage: emptyRelayUsage(),
      responseBody: payload,
    });
    app.log.error({ err: error, requestId, protocol: config.protocol }, "native relay request failed");
    if (reply.sent || reply.raw.headersSent) {
      if (!reply.raw.destroyed) {
        reply.raw.destroy(error instanceof Error ? error : undefined);
      }
      return reply;
    }
    reply.removeHeader("cache-control");
    reply.removeHeader("x-accel-buffering");
    reply.type("application/json; charset=utf-8");
    return reply.code(cancelled ? 499 : 500).send(payload);
  } finally {
    if (!streamHandedOff) {
      activeAttempt?.abort(new Error("native relay response lifecycle ended before consumption"));
      activeAttempt = null;
      await releaseQuota(app, requestId, lease);
    }
  }
}

async function handleNativeParsingError(
  app: FastifyInstance,
  error: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  if (reply.sent) return reply;
  const protocol: NativeProtocol = "anthropic_messages";
  const suppliedStatus = typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : undefined;
  const status = suppliedStatus && suppliedStatus >= 400 && suppliedStatus <= 599
    ? suppliedStatus
    : 500;
  const requestId = `threq_${randomUUID().replaceAll("-", "")}`;
  const clientError = status < 500;
  const code = status === 413
    ? "request_too_large"
    : status === 415
      ? "unsupported_media_type"
      : clientError
        ? "invalid_request"
        : "relay_internal_error";
  const type = status === 413
    ? "request_too_large"
    : status === 404
      ? "not_found_error"
      : clientError
        ? "invalid_request_error"
        : "api_error";
  const message = status === 413
    ? "请求正文超过网关允许的 32 MiB"
    : status === 415
      ? "请求必须使用 application/json"
      : clientError
        ? "请求正文不是有效的 JSON"
        : "TokenHub 处理请求时发生内部错误";
  const payload = nativeError(requestId, message, type, code);

  reply.header("x-tokenhub-request-id", requestId);
  reply.header("request-id", requestId);

  if (req.relayPrincipal) {
    await persistAudit(app, {
      requestId,
      principal: req.relayPrincipal,
      protocol,
      clientModel: originalModel(req.body),
      candidate: null,
      isStream: false,
      status: clientError ? "client_error" : "upstream_error",
      httpStatus: status,
      upstreamStatus: null,
      errorCode: code,
      errorMessage: error instanceof Error ? error.message : String(error),
      usage: emptyRelayUsage(),
      latencyMs: 0,
      retryTrace: [],
      requestHeaders: sanitizeRelayRequestHeaders(req),
      requestBody: req.body ?? null,
      responseBody: payload,
      clientIp: req.ip,
      userAgent: requestUserAgent(req),
      requestPath: req.url,
    });
  }
  if (!clientError) {
    app.log.error({ err: error, requestId, protocol }, "native route pre-handler failed");
  }
  return reply.code(status).type("application/json; charset=utf-8").send(payload);
}

export async function anthropicMessageRoutes(app: FastifyInstance) {
  app.setErrorHandler((error, req, reply) =>
    handleNativeParsingError(app, error, req, reply));
  for (const config of routeConfigs) {
    app.post(
      config.path,
      {
        onRequest: createRequireRelayApiKey(config.protocol),
        // Anthropic's Messages API accepts request bodies up to 32 MiB.
        bodyLimit: 32 * 1024 * 1024,
      },
      (req, reply) => handleNativeRequest(app, config, req, reply),
    );
  }
}
