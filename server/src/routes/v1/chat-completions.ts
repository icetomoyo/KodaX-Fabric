import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config.js";
import {
  emptyRelayUsage,
  parseRelayUsage,
  sanitizeRelayRequestHeaders,
  writeRelayAudit,
  type RelayAuditInput,
} from "../../lib/relay/audit.js";
import {
  acquireRelayQuota,
  RelayLimitError,
  type RelayQuotaLease,
} from "../../lib/relay/quota.js";
import { RELAY_ENDPOINTS } from "../../lib/relay/protocol.js";
import {
  resolveAccessibleRelayModels,
  resolveRelayCandidates,
} from "../../lib/relay/routing.js";
import { createSsePassthrough } from "../../lib/relay/sse.js";
import type {
  RelayCandidate,
  RelayRetryTraceItem,
} from "../../lib/relay/types.js";
import {
  sendRelayUpstreamChat,
  type RelayUpstreamAttemptKind,
  type RelayUpstreamAttemptResult,
} from "../../lib/relay/upstream.js";
import {
  requireAnyRelayApiKey,
  requireRelayApiKey,
} from "../../middleware/api-key.js";

const chatCompletionSchema = z
  .object({
    model: z.string().trim().min(1).max(128),
    messages: z.array(z.unknown()).min(1),
    stream: z.boolean().optional().default(false),
  })
  .passthrough();

type ChatCompletionBody = z.infer<typeof chatCompletionSchema>;
type JsonObject = Record<string, unknown>;

export class RelayResponseTooLargeError extends Error {
  constructor() {
    super("上游响应超过网关允许的大小");
    this.name = "RelayResponseTooLargeError";
  }
}

function openAiError(message: string, type: string, code: string) {
  return {
    error: {
      message,
      type,
      param: null,
      code,
    },
  };
}

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
  return {
    contentType,
    raw: raw.toString("utf8"),
  };
}

export async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel(new RelayResponseTooLargeError());
        throw new RelayResponseTooLargeError();
      }
      chunks.push(Buffer.from(next.value));
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Cancellation is best effort; the request lifetime abort is the fallback.
    }
    throw error;
  }

  return Buffer.concat(chunks, size);
}

export async function readFirstNonEmptyChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  while (true) {
    const next = await reader.read();
    if (next.done || next.value.byteLength > 0) return next;
  }
}

export function toFastifyReadable(
  stream: ReadableStream<Uint8Array>,
): Readable {
  // Fastify recognizes Node streams. Passing a WHATWG ReadableStream directly
  // can fall through to object serialization on supported Node/Fastify pairs.
  return Readable.fromWeb(stream as unknown as NodeWebReadableStream);
}

async function discardResponse(response: Response | null): Promise<void> {
  if (!response?.body) return;
  try {
    await response.body.cancel();
  } catch {
    // The response may already be consumed or aborted.
  }
}

export async function settleFailedAttempt(
  result: RelayUpstreamAttemptResult,
  willRetry: boolean,
): Promise<"released" | "retained"> {
  if (!willRetry && result.response) return "retained";
  if (willRetry) await discardResponse(result.response);
  result.cleanup();
  return "released";
}

function safeContentType(response: Response): string {
  const contentType = response.headers.get("content-type");
  if (!contentType || /[\r\n]/.test(contentType)) return "application/json; charset=utf-8";
  return contentType;
}

function isOpenAiErrorPayload(value: unknown): value is JsonObject {
  if (!isJsonObject(value)) return false;
  const error = value.error;
  return typeof error === "string" || isJsonObject(error);
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
        type: "upstream_timeout",
        code: "upstream_timeout",
        message: "上游响应超时",
      };
    case "auth_error":
      return {
        status: 502,
        type: "upstream_error",
        code: "upstream_authentication_failed",
        message: "可用上游凭证鉴权失败",
      };
    case "cancelled":
      return {
        status: 499,
        type: "request_cancelled",
        code: "request_cancelled",
        message: "请求已取消",
      };
    case "configuration_error":
      return {
        status: 503,
        type: "service_unavailable",
        code: "upstream_configuration_error",
        message: "上游渠道配置不可用",
      };
    case "network_error":
      return {
        status: 502,
        type: "upstream_error",
        code: "upstream_network_error",
        message: "无法连接上游服务",
      };
    default:
      return {
        status: 502,
        type: "upstream_error",
        code: "upstream_unavailable",
        message: "上游服务暂时不可用",
      };
  }
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

function requestUserAgent(req: FastifyRequest): string | undefined {
  const value = req.headers["user-agent"];
  return Array.isArray(value) ? value.join(", ") : value;
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
    app.log.error({ err: error, requestId }, "failed to release relay quota lease");
  }
}

async function persistAudit(
  app: FastifyInstance,
  input: RelayAuditInput,
): Promise<void> {
  try {
    await writeRelayAudit(input);
  } catch (error) {
    app.log.error({ err: error, requestId: input.requestId }, "failed to write relay audit");
  }
}

function originalModel(body: unknown): string {
  if (!isJsonObject(body) || typeof body.model !== "string") return "(invalid)";
  return body.model.slice(0, 128) || "(invalid)";
}

function noRouteError(message = "当前账户没有可用于该模型的渠道") {
  return openAiError(
    message,
    "invalid_request_error",
    "model_not_found",
  );
}

export async function relayRoutes(app: FastifyInstance) {
  for (const path of [RELAY_ENDPOINTS.models, RELAY_ENDPOINTS.anthropicModels]) {
    app.get(
      path,
      { onRequest: requireAnyRelayApiKey },
      async (req, reply) => {
        const principal = req.relayPrincipal!;
        const requestId = `threq_${randomUUID().replaceAll("-", "")}`;
        reply.header("x-tokenhub-request-id", requestId);
        if (principal.protocol === "anthropic_messages") {
          reply.header("request-id", requestId);
        } else {
          reply.header("x-request-id", requestId);
        }
        const resolution = await resolveAccessibleRelayModels(
          principal.employeeId,
          principal.protocol,
          principal.productLineId,
        );
        if (resolution.unavailableReason === "bound_channel_unavailable") {
          if (principal.protocol === "anthropic_messages") {
            return reply.code(503).send({
              type: "error",
              error: {
                type: "api_error",
                message: "当前 Key 绑定的上游渠道不可用",
                code: "bound_channel_unavailable",
              },
              request_id: requestId,
            });
          }
          return reply.code(503).send(
            openAiError(
              "当前 Key 绑定的上游渠道不可用",
              "service_unavailable",
              "bound_channel_unavailable",
            ),
          );
        }
        const models = resolution.models;
        if (principal.protocol === "anthropic_messages") {
          return {
            data: models.map((model) => ({
              id: model.id,
              display_name: model.id,
            })),
          };
        }
        return {
          object: "list",
          data: models.map((model) => ({
            id: model.id,
            object: "model",
            created: 0,
            owned_by: model.ownedBy,
          })),
        };
      },
    );
  }

  app.post(
    RELAY_ENDPOINTS.chatCompletions,
    { onRequest: requireRelayApiKey },
    async (req, reply) => {
      const startedAt = Date.now();
      const requestId = `threq_${randomUUID().replaceAll("-", "")}`;
      const principal = req.relayPrincipal!;
      const requestHeaders = sanitizeRelayRequestHeaders(req);
      const requestBody = req.body;
      const parsed = chatCompletionSchema.safeParse(requestBody);
      const clientModel = parsed.success ? parsed.data.model : originalModel(requestBody);
      const isStream = parsed.success ? parsed.data.stream : false;
      const retryTrace: RelayRetryTraceItem[] = [];
      let lease: RelayQuotaLease | null = null;
      let activeAttempt: RelayUpstreamAttemptResult | null = null;
      let currentCandidate: RelayCandidate | null = null;
      let streamHandedOff = false;
      let auditWritten = false;

      reply.header("x-tokenhub-request-id", requestId);
      reply.header("x-request-id", requestId);

      const finalizeAudit = async (
        input: Omit<
          RelayAuditInput,
          | "requestId"
          | "principal"
          | "clientModel"
          | "isStream"
          | "latencyMs"
          | "retryTrace"
          | "requestHeaders"
          | "requestBody"
          | "clientIp"
          | "userAgent"
          | "requestPath"
        >,
      ) => {
        if (auditWritten) return;
        auditWritten = true;
        await persistAudit(app, {
          ...input,
          requestId,
          principal,
          clientModel,
          isStream,
          latencyMs: Date.now() - startedAt,
          retryTrace,
          requestHeaders,
          requestBody,
          clientIp: req.ip,
          userAgent: requestUserAgent(req),
          requestPath: req.url,
        });
      };

      try {
        if (!parsed.success) {
          const payload = openAiError(
            "请求参数无效：model 和 messages 为必填项",
            "invalid_request_error",
            "invalid_request",
          );
          await finalizeAudit({
            candidate: null,
            status: "client_error",
            httpStatus: 400,
            upstreamStatus: null,
            errorCode: "invalid_request",
            errorMessage: parsed.error.issues[0]?.message ?? "请求参数无效",
            usage: emptyRelayUsage(),
            responseBody: payload,
          });
          return reply.code(400).send(payload);
        }

        const body: ChatCompletionBody = parsed.data;

        try {
          lease = await acquireRelayQuota(principal.employeeId);
        } catch (error) {
          if (!(error instanceof RelayLimitError)) throw error;
          const payload = openAiError(error.message, "rate_limit_error", error.code);
          if (error.retryAfterSeconds) {
            reply.header("retry-after", String(error.retryAfterSeconds));
          }
          await finalizeAudit({
            candidate: null,
            status: "client_error",
            httpStatus: 429,
            upstreamStatus: null,
            errorCode: error.code,
            errorMessage: error.message,
            usage: emptyRelayUsage(),
            responseBody: payload,
          });
          return reply.code(429).send(payload);
        }

        const resolution = await resolveRelayCandidates(
          principal.employeeId,
          body.model,
          principal.protocol,
          principal.productLineId,
        );
        const candidates = resolution.candidates;
        if (candidates.length === 0) {
          const boundUnavailable =
            resolution.unavailableReason === "bound_channel_unavailable";
          const cooling = resolution.unavailableReason === "cooling";
          const unavailable = resolution.unavailableReason === "unavailable";
          const httpStatus = boundUnavailable || unavailable ? 503 : cooling ? 429 : 404;
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
                ? "该模型已配置，但当前没有可用的上游渠道"
                : "当前 Key 绑定的上游渠道不支持该模型";
          const payload = boundUnavailable
            ? openAiError(errorMessage, "service_unavailable", errorCode)
            : cooling
              ? openAiError(errorMessage, "rate_limit_error", errorCode)
              : unavailable
                ? openAiError(errorMessage, "service_unavailable", errorCode)
                : noRouteError(errorMessage);
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
          const result = await sendRelayUpstreamChat({
            candidate,
            body,
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
            if (disposition === "released") {
              activeAttempt = null;
            }
            if (willRetry) continue;
            break;
          }

          const response = result.response;

          if (!body.stream) {
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
            const usage = isJsonObject(responseJson)
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
              responseBody: auditBody(
                raw,
                responseJson,
                response.headers.get("content-type"),
              ),
            });
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
              // The upstream may already have closed the reader.
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
            try {
              await reader.cancel();
            } catch {
              // The reader is already at EOF.
            }
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
          const passthrough = createSsePassthrough(reader, {
            initialChunks: [firstChunk.value],
            maxAuditBytes: env.AUDIT_BODY_MAX_BYTES,
          });

          const cancelDownstream = () => {
            if (!reply.raw.writableFinished) {
              void passthrough.cancel(new Error("downstream connection closed"));
            }
          };
          const cancelRequest = () => {
            void passthrough.cancel(req.signal.reason);
          };
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
            const cancelled = !handoffFailed && completion.state === "cancelled";
            const streamFailed = handoffFailed ||
              completion.state === "errored" ||
              completion.audit.upstreamError !== null ||
              !completion.audit.doneSeen;
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
                    : !completion.audit.doneSeen
                      ? "upstream_stream_missing_done"
                      : "upstream_stream_error";
            }
            await finalizeAudit({
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
                    ? "上游流式响应中断"
                    : null,
              usage: completion.audit.usage,
              responseBody: {
                stream: true,
                state: completion.state,
                bytesSeen: completion.audit.bytesSeen,
                auditBytesCaptured: completion.audit.auditBytesCaptured,
                truncated: completion.audit.truncated,
                doneSeen: completion.audit.doneSeen,
                eventCount: completion.audit.eventCount,
                malformedEventCount: completion.audit.malformedEventCount,
                oversizedEventCount: completion.audit.oversizedEventCount,
                assembled: completion.audit.assembled,
                upstreamError: completion.audit.upstreamError,
              },
            });
          }).catch((error) => {
            app.log.error({ err: error, requestId }, "failed to finalize relay stream");
          });

          reply.headers({
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            "x-accel-buffering": "no",
          });
          reply.code(response.status);
          // From this point on the passthrough completion owns upstream cleanup,
          // quota release and audit finalization, even if reply.send throws.
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
        if (failure?.kind === "client_error" && failure.response) {
          let raw: Buffer<ArrayBufferLike> = Buffer.alloc(0);
          try {
            raw = await readBoundedBody(
              failure.response,
              Math.min(env.AUDIT_BODY_MAX_BYTES, 1024 * 1024),
            );
          } catch {
            failure.abort();
          } finally {
            failure.cleanup();
            activeAttempt = null;
          }
          const responseJson = parseJson(raw);
          const payload = isOpenAiErrorPayload(responseJson)
            ? responseJson
            : openAiError(
                failure.errorMessage ?? "上游拒绝了请求参数",
                "invalid_request_error",
                failure.errorCode ?? "upstream_client_error",
              );
          const status = failure.status && failure.status >= 400 && failure.status < 500
            ? failure.status
            : 400;
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
          return reply.code(status).send(payload);
        }

        if (failure?.response) {
          await discardResponse(failure.response);
          failure.cleanup();
          activeAttempt = null;
        }
        const mapped = downstreamFailure(failure?.kind ?? "upstream_error");
        const payload = openAiError(mapped.message, mapped.type, mapped.code);
        if (mapped.status === 429) {
          reply.header("retry-after", String(env.RELAY_COOLDOWN_SECONDS));
        }
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
          ? openAiError("请求已取消", "request_cancelled", "request_cancelled")
          : openAiError(
              "TokenHub 处理请求时发生内部错误",
              "internal_error",
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
        app.log.error({ err: error, requestId }, "relay request failed");
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
          activeAttempt?.abort(new Error("relay response lifecycle ended before consumption"));
          activeAttempt = null;
          await releaseQuota(app, requestId, lease);
        }
      }
    },
  );
}
