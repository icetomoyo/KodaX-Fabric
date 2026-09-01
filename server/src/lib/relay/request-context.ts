/**
 * Persist the full relay request envelope as a gzip JSON file.
 * Postgres keeps metering only; this is the boss-facing request context.
 *
 * Layout: `<root>/<quota-day>/<requestId>.json.gz`
 * Retention is unlimited until an operator deletes files.
 */
import type { IncomingHttpHeaders } from "node:http";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzip } from "node:zlib";
import { env } from "../../config.js";
import { addCalendarDays, quotaDayAt } from "../quota-time.js";
import type { RelayCandidate, RelayPrincipal, RelayRetryTraceItem, RelayUsage } from "./types.js";

const gzipAsync = promisify(gzip);

export const REQUEST_CONTEXT_ID_PATTERN = /^[A-Za-z0-9_-]{8,96}$/;
const SAFE_REQUEST_ID = REQUEST_CONTEXT_ID_PATTERN;
const REDACTED = "[redacted]";
const HEADER_REDACT =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|anthropic-api-key|x-goog-api-key)$/i;
const VALUE_KEY_REDACT =
  /^(authorization|api[_-]?key|secret|secretencrypted|secret_encrypted|password|passwordhash|x-api-key)$/i;

export type RequestContextStreamAudit = {
  truncated: boolean;
  doneSeen?: boolean;
  terminalSeen?: boolean;
  eventCount: number;
  assembled: unknown;
};

export type RequestContextInput = {
  path: string;
  stream: boolean;
  headers: IncomingHttpHeaders | Record<string, unknown>;
  requestBody: unknown;
  retryTrace: readonly RelayRetryTraceItem[];
  responseBody?: unknown;
  streamAudit?: RequestContextStreamAudit | null;
};

export type RequestContextRecord = {
  requestId: string;
  startedAt: string;
  endedAt: string;
  latencyMs: number;
  protocol: string;
  path: string;
  stream: boolean;
  clientModel: string;
  status: string;
  httpStatus: number | null;
  upstreamStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  principal: {
    employeeId: number;
    employeeApiKeyId: number;
    teamId: number | null;
    employeeName: string;
    productLineId: number;
  };
  candidate: {
    credentialId: number;
    credentialSuffix: string;
    providerCode: string;
    productLineId: number;
    productType: string;
    upstreamModel: string;
    baseUrl: string;
  } | null;
  headers: Record<string, string>;
  requestBody: unknown;
  responseBody: unknown;
  streamAudit: RequestContextStreamAudit | null;
  retryTrace: RelayRetryTraceItem[];
  usage: RelayUsage | null;
  truncated: boolean;
};

type Logger = {
  error: (obj: unknown, msg?: string) => void;
};

export function assertSafeRequestId(requestId: string): string {
  if (!SAFE_REQUEST_ID.test(requestId)) {
    throw new Error("unsafe request id");
  }
  return requestId;
}

export function requestContextFilePath(
  rootDir: string,
  day: string,
  requestId: string,
): string {
  assertSafeRequestId(requestId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("invalid context day");
  }
  return join(rootDir, day, `${requestId}.json.gz`);
}

/** Look up the gzip file for a request, trying the quota day and its neighbours. */
export async function findRequestContextFile(
  rootDir: string,
  timeZone: string,
  requestId: string,
  createdAt: Date,
): Promise<string | null> {
  assertSafeRequestId(requestId);
  const day = quotaDayAt(createdAt, timeZone);
  const days = [day, addCalendarDays(day, -1), addCalendarDays(day, 1)];
  for (const candidate of days) {
    const path = requestContextFilePath(rootDir, candidate, requestId);
    try {
      await access(path, fsConstants.R_OK);
      return path;
    } catch {
      // Missing on this day; try the adjacent quota day.
    }
  }
  return null;
}

export async function readRequestContextRecord(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath);
  return JSON.parse(gunzipSync(raw).toString("utf8"));
}

/** Inline detail is for the drawer; 50MB files stay on the download endpoint. */
export const DETAIL_CONTEXT_MAX_BYTES = 256 * 1024;
const DETAIL_OMITTED = { omitted: "正文过大，请下载 JSON 查看" };

export function summarizeRequestContextForDetail(
  record: unknown,
  maxBytes = DETAIL_CONTEXT_MAX_BYTES,
): { context: unknown; omittedBodies: boolean } {
  if (record == null || typeof record !== "object") {
    return { context: record, omittedBodies: false };
  }
  if (Buffer.byteLength(JSON.stringify(record)) <= maxBytes) {
    return { context: record, omittedBodies: false };
  }
  const input = record as Record<string, unknown>;
  const streamAudit = input.streamAudit;
  const stripped: Record<string, unknown> = {
    ...input,
    requestBody: DETAIL_OMITTED,
    responseBody: DETAIL_OMITTED,
    streamAudit:
      streamAudit && typeof streamAudit === "object"
        ? { ...(streamAudit as Record<string, unknown>), assembled: DETAIL_OMITTED }
        : streamAudit,
  };
  if (Buffer.byteLength(JSON.stringify(stripped)) > maxBytes) {
    stripped.headers = DETAIL_OMITTED;
    stripped.retryTrace = [];
  }
  return { context: stripped, omittedBodies: true };
}

export function redactHeaders(
  headers: IncomingHttpHeaders | Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    if (rawValue == null) continue;
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
    result[rawName] = HEADER_REDACT.test(rawName) ? REDACTED : value;
  }
  return result;
}

export function sanitizeContextValue(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(sanitizeContextValue);
  if (typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(input)) {
    if (VALUE_KEY_REDACT.test(key) || key === "secretEncrypted") {
      output[key] = REDACTED;
      continue;
    }
    output[key] = sanitizeContextValue(nested);
  }
  return output;
}

export function publicCandidate(candidate: RelayCandidate | null | undefined): RequestContextRecord["candidate"] {
  if (!candidate) return null;
  return {
    credentialId: candidate.credentialId,
    credentialSuffix: candidate.credentialSuffix,
    providerCode: candidate.providerCode,
    productLineId: candidate.productLineId,
    productType: candidate.productType,
    upstreamModel: candidate.upstreamModel,
    baseUrl: candidate.baseUrl,
  };
}

export function publicPrincipal(principal: RelayPrincipal): RequestContextRecord["principal"] {
  return {
    employeeId: principal.employeeId,
    employeeApiKeyId: principal.employeeApiKeyId,
    teamId: principal.teamId,
    employeeName: principal.employeeName,
    productLineId: principal.productLineId,
  };
}

export function serializeRequestContext(
  record: RequestContextRecord,
  maxBytes: number,
): { json: string; truncated: boolean } {
  const full = { ...record, truncated: false };
  let json = JSON.stringify(full);
  if (Buffer.byteLength(json) <= maxBytes) return { json, truncated: false };

  const stripped: RequestContextRecord = {
    ...record,
    truncated: true,
    requestBody: { omitted: "request body exceeded REQUEST_CONTEXT_MAX_BYTES" },
    responseBody: { omitted: "response body exceeded REQUEST_CONTEXT_MAX_BYTES" },
    streamAudit: record.streamAudit
      ? {
          truncated: true,
          doneSeen: record.streamAudit.doneSeen,
          terminalSeen: record.streamAudit.terminalSeen,
          eventCount: record.streamAudit.eventCount,
          assembled: { omitted: "assembled stream exceeded REQUEST_CONTEXT_MAX_BYTES" },
        }
      : null,
  };
  json = JSON.stringify(stripped);
  if (Buffer.byteLength(json) <= maxBytes) return { json, truncated: true };

  const minimal = {
    requestId: record.requestId,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    status: record.status,
    truncated: true,
    error: "context exceeded REQUEST_CONTEXT_MAX_BYTES after stripping bodies",
  };
  return { json: JSON.stringify(minimal), truncated: true };
}

export function buildRequestContextRecord(input: {
  requestId: string;
  startedAt: Date;
  endedAt?: Date;
  principal: RelayPrincipal;
  clientModel: string;
  candidate?: RelayCandidate | null;
  status: string;
  httpStatus?: number | null;
  upstreamStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  usage?: RelayUsage | null;
  context: RequestContextInput;
}): RequestContextRecord {
  const endedAt = input.endedAt ?? new Date();
  const responseBody = input.context.responseBody ?? input.context.streamAudit?.assembled ?? null;
  return {
    requestId: input.requestId,
    startedAt: input.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    latencyMs: Math.max(0, endedAt.getTime() - input.startedAt.getTime()),
    protocol: input.principal.protocol,
    path: input.context.path,
    stream: input.context.stream,
    clientModel: input.clientModel,
    status: input.status,
    httpStatus: input.httpStatus ?? null,
    upstreamStatus: input.upstreamStatus ?? null,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    principal: publicPrincipal(input.principal),
    candidate: publicCandidate(input.candidate),
    headers: redactHeaders(input.context.headers),
    requestBody: sanitizeContextValue(input.context.requestBody),
    responseBody: sanitizeContextValue(responseBody),
    streamAudit: input.context.streamAudit
      ? {
          ...input.context.streamAudit,
          assembled: sanitizeContextValue(input.context.streamAudit.assembled),
        }
      : null,
    retryTrace: [...input.context.retryTrace],
    usage: input.usage ?? null,
    truncated: false,
  };
}

export async function writeRequestContextFile(options: {
  rootDir: string;
  timeZone: string;
  maxBytes: number;
  record: Omit<RequestContextRecord, "truncated"> & { truncated?: boolean };
}): Promise<string> {
  const day = quotaDayAt(new Date(options.record.startedAt), options.timeZone);
  const target = requestContextFilePath(options.rootDir, day, options.record.requestId);
  const { json } = serializeRequestContext(
    { ...options.record, truncated: options.record.truncated ?? false },
    options.maxBytes,
  );
  const compressed = await gzipAsync(Buffer.from(json, "utf8"));
  await mkdir(dirname(target), { recursive: true });
  const staging = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(staging, compressed);
    await rename(staging, target);
  } catch (error) {
    await unlink(staging).catch(() => undefined);
    throw error;
  }
  return target;
}

export function scheduleRequestContextWrite(logger: Logger, record: RequestContextRecord): void {
  void writeRequestContextFile({
    rootDir: env.REQUEST_CONTEXT_DIR,
    timeZone: env.QUOTA_TIMEZONE,
    maxBytes: env.REQUEST_CONTEXT_MAX_BYTES,
    record,
  }).catch((err) => {
    logger.error({ err, requestId: record.requestId }, "failed to write request context");
  });
}
