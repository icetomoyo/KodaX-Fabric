import type { FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  employeeApiKeys,
  requestAuditBodies,
  requestAudits,
  usageCountersDaily,
} from "../../db/schema/index.js";
import type { EffectiveRelayQuota } from "./quota.js";
import type { RelayProtocol } from "./protocol.js";
import type {
  RelayCandidate,
  RelayPrincipal,
  RelayRetryTraceItem,
  RelayUsage,
} from "./types.js";

type RelayAuditStatus = "success" | "upstream_error" | "client_error" | "cancelled";

const AUDIT_REDACTION = "[REDACTED]";
const SENSITIVE_BODY_KEYS = new Set([
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
]);

export type RelayAuditInput = {
  requestId: string;
  principal: RelayPrincipal;
  protocol?: RelayProtocol;
  clientModel: string;
  candidate?: RelayCandidate | null;
  isStream: boolean;
  status: RelayAuditStatus;
  httpStatus: number;
  upstreamStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  usage?: RelayUsage | null;
  latencyMs: number;
  retryTrace: RelayRetryTraceItem[];
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseBody: unknown;
  quota?: EffectiveRelayQuota | null;
  softLimitHit?: boolean;
  clientIp?: string;
  userAgent?: string;
  requestPath?: string;
};

const AUDIT_HEADER_ALLOWLIST = new Set([
  "content-type",
  "content-length",
  "user-agent",
  "x-request-id",
  "anthropic-version",
  "anthropic-beta",
  "openai-beta",
]);

function normalizedSensitiveKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Redact credentials embedded in native tool/MCP request bodies without
 * changing the object that is forwarded upstream.
 */
export function sanitizeRelayAuditBody(value: unknown): unknown {
  const seen = new WeakSet<object>();

  const visit = (current: unknown): unknown => {
    if (current === null || typeof current !== "object") return current;
    if (seen.has(current)) return "[CIRCULAR]";
    seen.add(current);

    if (Array.isArray(current)) return current.map((item) => visit(item));

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      const normalized = normalizedSensitiveKey(key);
      if (normalized === "headers" || SENSITIVE_BODY_KEYS.has(normalized)) {
        result[key] = AUDIT_REDACTION;
      } else {
        result[key] = visit(item);
      }
    }
    return result;
  };

  return visit(value);
}

function safeJsonSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return 0;
  }
}

function prepareAuditValue(value: unknown): {
  value: unknown;
  size: number;
  truncated: boolean;
} {
  let serialized: string;
  try {
    serialized = JSON.stringify(value ?? null);
  } catch {
    serialized = JSON.stringify({ error: "内容无法序列化" });
  }
  const size = Buffer.byteLength(serialized, "utf8");
  if (size <= env.AUDIT_BODY_MAX_BYTES) {
    return { value: value ?? null, size, truncated: false };
  }
  return {
    value: {
      truncated: true,
      originalBytes: size,
      preview: serialized.slice(0, env.AUDIT_BODY_MAX_BYTES),
    },
    size,
    truncated: true,
  };
}

function safeInteger(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(2_147_483_647, Math.trunc(value)));
}

export function sanitizeRelayHeaderRecord(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (!AUDIT_HEADER_ALLOWLIST.has(name) || value === undefined) continue;
    result[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return result;
}

export function sanitizeRelayRequestHeaders(req: FastifyRequest): Record<string, string> {
  return sanitizeRelayHeaderRecord(req.headers);
}

export function emptyRelayUsage(): RelayUsage {
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    raw: null,
  };
}

export function parseRelayUsage(value: unknown): RelayUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyRelayUsage();
  const raw = value as Record<string, unknown>;
  const numberValue = (...keys: string[]): number | null => {
    for (const key of keys) {
      const candidate = raw[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return Math.max(0, Math.trunc(candidate));
      }
    }
    return null;
  };
  const basePromptTokens = numberValue("prompt_tokens", "input_tokens");
  const cacheCreationTokens = numberValue("cache_creation_input_tokens");
  const cacheReadTokens = numberValue("cache_read_input_tokens");
  const hasAnthropicInputBreakdown =
    cacheCreationTokens !== null || cacheReadTokens !== null;
  const promptTokens = hasAnthropicInputBreakdown
    ? (basePromptTokens ?? 0) + (cacheCreationTokens ?? 0) + (cacheReadTokens ?? 0)
    : basePromptTokens;
  const completionTokens = numberValue("completion_tokens", "output_tokens");
  const suppliedTotal = numberValue("total_tokens");
  const totalTokens = suppliedTotal ??
    (promptTokens !== null && completionTokens !== null
      ? promptTokens + completionTokens
      : null);
  return { promptTokens, completionTokens, totalTokens, raw };
}

export async function writeRelayAudit(input: RelayAuditInput): Promise<void> {
  const request = prepareAuditValue(sanitizeRelayAuditBody(input.requestBody));
  const response = prepareAuditValue(sanitizeRelayAuditBody(input.responseBody));
  // Defend at the persistence boundary as well as at request extraction. This
  // prevents a future caller from accidentally storing either employee or
  // upstream Authorization credentials.
  const requestHeaders = sanitizeRelayHeaderRecord(input.requestHeaders);
  const usage = input.usage ?? emptyRelayUsage();
  const promptTokens = safeInteger(usage.promptTokens) ?? 0;
  const completionTokens = safeInteger(usage.completionTokens) ?? 0;
  const totalTokens = safeInteger(usage.totalTokens) ?? 0;
  const errorCount = input.status === "success" ? 0 : 1;
  const incomingSoftLimitHit = Boolean(
    input.softLimitHit ||
      (input.quota?.softTpmDay !== null &&
        input.quota?.softTpmDay !== undefined &&
        totalTokens >= input.quota.softTpmDay) ||
      (input.quota?.softReqDay !== null &&
        input.quota?.softReqDay !== undefined &&
        1 >= input.quota.softReqDay),
  );

  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(requestAudits)
      .values({
        requestId: input.requestId,
        employeeId: input.principal.employeeId,
        employeeApiKeyId: input.principal.employeeApiKeyId,
        protocol: input.protocol ?? input.principal.protocol,
        clientModel: input.clientModel.slice(0, 128),
        upstreamModel: input.candidate?.upstreamModel,
        providerCode: input.candidate?.providerCode,
        productLineId: input.candidate?.productLineId,
        productType: input.candidate?.productType,
        credentialId: input.candidate?.credentialId,
        credentialSuffix: input.candidate?.credentialSuffix,
        isStream: input.isStream,
        status: input.status,
        httpStatus: input.httpStatus,
        upstreamStatus: input.upstreamStatus ?? null,
        errorCode: input.errorCode?.slice(0, 64) ?? null,
        errorMessage: input.errorMessage ?? null,
        promptTokens: safeInteger(usage.promptTokens),
        completionTokens: safeInteger(usage.completionTokens),
        totalTokens: safeInteger(usage.totalTokens),
        usageSource: usage.raw ? "upstream" : "none",
        usageRaw: usage.raw,
        latencyMs: safeInteger(input.latencyMs),
        retryCount: Math.max(0, input.retryTrace.length - 1),
        retryTrace: input.retryTrace,
        clientIp: input.clientIp,
        userAgent: input.userAgent,
        requestPath: input.requestPath,
      })
      .onConflictDoNothing()
      .returning({ requestId: requestAudits.requestId });

    if (!inserted) return;

    await tx.insert(requestAuditBodies).values({
      requestId: input.requestId,
      requestHeaders,
      requestBody: request.value,
      responseBody: response.value,
      requestBodySize: request.size || safeJsonSize(input.requestBody),
      responseBodySize: response.size || safeJsonSize(input.responseBody),
      truncated: request.truncated || response.truncated,
    });

    let softLimitExpression = sql`${usageCountersDaily.softLimitHit} or ${incomingSoftLimitHit}`;
    if (input.quota?.softTpmDay !== null && input.quota?.softTpmDay !== undefined) {
      softLimitExpression = sql`${softLimitExpression} or (${usageCountersDaily.totalTokens} + ${totalTokens} >= ${input.quota.softTpmDay})`;
    }
    if (input.quota?.softReqDay !== null && input.quota?.softReqDay !== undefined) {
      softLimitExpression = sql`${softLimitExpression} or (${usageCountersDaily.requestCount} + 1 >= ${input.quota.softReqDay})`;
    }

    await tx
      .insert(usageCountersDaily)
      .values({
        // Evaluate the day inside PostgreSQL so quota checks, counters and
        // dashboards all use the database's configured local timezone.
        day: sql`current_date`,
        employeeId: input.principal.employeeId,
        promptTokens,
        completionTokens,
        totalTokens,
        requestCount: 1,
        errorCount,
        softLimitHit: incomingSoftLimitHit,
      })
      .onConflictDoUpdate({
        target: [usageCountersDaily.day, usageCountersDaily.employeeId],
        set: {
          promptTokens: sql`${usageCountersDaily.promptTokens} + ${promptTokens}`,
          completionTokens: sql`${usageCountersDaily.completionTokens} + ${completionTokens}`,
          totalTokens: sql`${usageCountersDaily.totalTokens} + ${totalTokens}`,
          requestCount: sql`${usageCountersDaily.requestCount} + 1`,
          errorCount: sql`${usageCountersDaily.errorCount} + ${errorCount}`,
          softLimitHit: softLimitExpression,
        },
      });

    await tx
      .update(employeeApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(sql`${employeeApiKeys.id} = ${input.principal.employeeApiKeyId}`);
  });
}
