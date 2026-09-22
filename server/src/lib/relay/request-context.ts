/**
 * Persist relay request envelopes with content-addressed dedup.
 * Postgres keeps metering only; this is the boss-facing request context.
 *
 * Layout (contextFormat 2):
 *   <root>/files/<aa>/<sha256>                            decoded binaries (document/image base64 blocks)
 *   <root>/blocks/<aa>/<sha256>.gz                        sanitized JSON blocks (system/tools/long content)
 *   <root>/users/<employeeId>/<quota-day>/<requestId>.json.gz   slim envelope, refs point into the stores
 *   <root>/<quota-day>/<requestId>.json.gz                legacy full-envelope layout, read-only
 *
 * Every request still gets its own envelope; repeated heavy content is stored
 * once and referenced as { blob, kind, bytes, media_type }. Hydration rebuilds
 * the exact JSON shape the model saw. Retention is unlimited by design.
 */
import type { IncomingHttpHeaders } from "node:http";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzip, gzipSync } from "node:zlib";
import { createHash, randomBytes } from "node:crypto";
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
const CONTEXT_FORMAT = 2;
const BLOB_HASH_RE = /^[a-f0-9]{64}$/;
export const DEFAULT_BLOB_MIN_BYTES = 1024;

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
  contextFormat?: number;
};

/** Pointer to a deduped object in the content store. */
export type ContextBlobRef = {
  blob: string;
  kind: "file" | "block";
  bytes: number;
  media_type?: string;
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

export function userRequestContextFilePath(
  rootDir: string,
  employeeId: number,
  day: string,
  requestId: string,
): string {
  assertSafeRequestId(requestId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("invalid context day");
  }
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
    throw new Error("invalid employee id");
  }
  return join(rootDir, "users", String(employeeId), day, `${requestId}.json.gz`);
}

/** Content store path; keeps hashes constrained so hydration cannot traverse. */
export function contextBlobFilePath(
  rootDir: string,
  kind: "file" | "block",
  hash: string,
): string {
  if (!BLOB_HASH_RE.test(hash)) {
    throw new Error("unsafe blob hash");
  }
  const shard = hash.slice(0, 2);
  return kind === "file"
    ? join(rootDir, "files", shard, hash)
    : join(rootDir, "blocks", shard, `${hash}.gz`);
}

/** Look up the envelope for a request: per-user layout first, legacy day layout as fallback. */
export async function findRequestContextFile(
  rootDir: string,
  timeZone: string,
  requestId: string,
  createdAt: Date,
  employeeId?: number | null,
): Promise<string | null> {
  assertSafeRequestId(requestId);
  const day = quotaDayAt(createdAt, timeZone);
  const days = [day, addCalendarDays(day, -1), addCalendarDays(day, 1)];
  const candidates: string[] = [];
  if (employeeId != null && Number.isSafeInteger(employeeId) && employeeId > 0) {
    for (const d of days) candidates.push(userRequestContextFilePath(rootDir, employeeId, d, requestId));
  }
  for (const d of days) candidates.push(requestContextFilePath(rootDir, d, requestId));
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.R_OK);
      return candidate;
    } catch {
      // Missing here; try the next candidate.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Write side: plan blobs, store them, emit a slim envelope.
// ---------------------------------------------------------------------------

type BlobPlan = {
  path: string;
  value: unknown;
  kind: "file" | "block";
  hash: string;
  bytes: number;
  mediaType?: string;
  payload: Buffer;
};

export type WrittenContextBlob = {
  hash: string;
  kind: "file" | "block";
  bytes: number;
  mediaType?: string;
};

/** A base64 document/image content block is stored decoded, keyed by its bytes. */
function binaryBlockPlan(value: unknown): { payload: Buffer; mediaType: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const block = value as Record<string, unknown>;
  if (block.type !== "document" && block.type !== "image") return null;
  const source = block.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const src = source as Record<string, unknown>;
  if (src.type !== "base64" || typeof src.data !== "string" || src.data.length === 0) return null;
  const payload = Buffer.from(src.data, "base64");
  if (payload.length === 0) return null;
  const mediaType = typeof src.media_type === "string" ? src.media_type : "application/octet-stream";
  return { payload, mediaType };
}

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/**
 * Collect the oversized subtrees of a sanitized record: every top-level
 * requestBody field except messages (system/tools/...), each message content
 * block, responseBody, and streamAudit.assembled. Values below the threshold
 * stay inline in the envelope.
 */
function planContextBlobs(record: RequestContextRecord, blobMinBytes: number): BlobPlan[] {
  const plans: BlobPlan[] = [];
  const consider = (path: string, value: unknown) => {
    if (value == null) return;
    const json = JSON.stringify(value);
    if (json == null) return;
    const plainBytes = Buffer.byteLength(json);
    if (plainBytes < blobMinBytes) return;
    const binary = binaryBlockPlan(value);
    if (binary) {
      plans.push({
        path,
        value,
        kind: "file",
        hash: sha256Hex(binary.payload),
        bytes: binary.payload.length,
        mediaType: binary.mediaType,
        payload: binary.payload,
      });
      return;
    }
    plans.push({
      path,
      value,
      kind: "block",
      hash: sha256Hex(json),
      bytes: plainBytes,
      payload: gzipSync(Buffer.from(json, "utf8")),
    });
  };

  const requestBody = record.requestBody;
  if (requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)) {
    const body = requestBody as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      if (key !== "messages") consider(`requestBody.${key}`, value);
    }
    if (Array.isArray(body.messages)) {
      body.messages.forEach((message, i) => {
        if (!message || typeof message !== "object" || Array.isArray(message)) return;
        const content = (message as Record<string, unknown>).content;
        if (Array.isArray(content)) {
          content.forEach((block, j) => consider(`requestBody.messages[${i}].content[${j}]`, block));
        } else {
          consider(`requestBody.messages[${i}].content`, content);
        }
      });
    }
  } else {
    consider("requestBody", requestBody);
  }
  consider("responseBody", record.responseBody);
  if (record.streamAudit) consider("streamAudit.assembled", record.streamAudit.assembled);
  return plans;
}

function blobRefFor(plan: BlobPlan): ContextBlobRef {
  const ref: ContextBlobRef = { blob: plan.hash, kind: plan.kind, bytes: plan.bytes };
  if (plan.kind === "file" && plan.mediaType) ref.media_type = plan.mediaType;
  return ref;
}

/** Replace planned subtrees with refs; hashes in `failed` fall back to inline values. */
function applyBlobRefs(
  record: RequestContextRecord,
  plans: BlobPlan[],
  failed: Set<string>,
): RequestContextRecord {
  const refForPath = new Map<string, ContextBlobRef>();
  for (const plan of plans) {
    if (!failed.has(plan.hash)) refForPath.set(plan.path, blobRefFor(plan));
  }
  const refOr = (path: string, value: unknown) => refForPath.get(path) ?? value;

  let slimRequest = record.requestBody;
  const body = record.requestBody;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const source = body as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (key !== "messages") {
        next[key] = refOr(`requestBody.${key}`, value);
        continue;
      }
      if (Array.isArray(value)) {
        next[key] = value.map((message, i) => {
          if (!message || typeof message !== "object" || Array.isArray(message)) return message;
          const content = (message as Record<string, unknown>).content;
          if (Array.isArray(content)) {
            return {
              ...(message as Record<string, unknown>),
              content: content.map((block, j) => refOr(`requestBody.messages[${i}].content[${j}]`, block)),
            };
          }
          return { ...(message as Record<string, unknown>), content: refOr(`requestBody.messages[${i}].content`, content) };
        });
      } else {
        next[key] = value;
      }
    }
    slimRequest = next;
  }

  return {
    ...record,
    contextFormat: CONTEXT_FORMAT,
    requestBody: slimRequest,
    responseBody: refOr("responseBody", record.responseBody),
    streamAudit: record.streamAudit
      ? { ...record.streamAudit, assembled: refOr("streamAudit.assembled", record.streamAudit.assembled) }
      : record.streamAudit,
  };
}

async function writeStoreObject(target: string, payload: Buffer): Promise<void> {
  try {
    await access(target, fsConstants.R_OK);
    return; // already stored; content-addressed so identical by definition
  } catch {
    // Not stored yet.
  }
  await mkdir(dirname(target), { recursive: true });
  // Random suffix: concurrent writers of the same hash must not share staging files.
  const staging = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(staging, payload);
    await rename(staging, target);
  } catch (error) {
    await unlink(staging).catch(() => undefined);
    throw error;
  }
}

export async function writeRequestContextFile(options: {
  rootDir: string;
  timeZone: string;
  maxBytes: number;
  blobMinBytes?: number;
  record: Omit<RequestContextRecord, "truncated"> & { truncated?: boolean };
  onBlobsWritten?: (input: {
    blobs: WrittenContextBlob[];
    employeeId: number;
    teamId: number | null;
    requestId: string;
  }) => Promise<void>;
}): Promise<string> {
  const record: RequestContextRecord = {
    ...(options.record as RequestContextRecord),
    truncated: options.record.truncated ?? false,
  };
  const day = quotaDayAt(new Date(record.startedAt), options.timeZone);
  const target = userRequestContextFilePath(options.rootDir, record.principal.employeeId, day, record.requestId);

  const plans = planContextBlobs(record, options.blobMinBytes ?? DEFAULT_BLOB_MIN_BYTES);
  const failed = new Set<string>();
  const written: WrittenContextBlob[] = [];
  for (const plan of plans) {
    try {
      await writeStoreObject(contextBlobFilePath(options.rootDir, plan.kind, plan.hash), plan.payload);
      written.push({ hash: plan.hash, kind: plan.kind, bytes: plan.bytes, mediaType: plan.mediaType });
    } catch {
      // Hard rule from the plan: a failed blob falls back to inline content so
      // this request can always be reconstructed.
      failed.add(plan.hash);
    }
  }

  const envelope = applyBlobRefs(record, plans, failed);
  const { json } = serializeRequestContext(envelope, options.maxBytes);
  const compressed = await gzipAsync(Buffer.from(json, "utf8"));
  await mkdir(dirname(target), { recursive: true });
  const staging = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(staging, compressed);
    await rename(staging, target);
  } catch (error) {
    await unlink(staging).catch(() => undefined);
    throw error;
  }

  if (written.length > 0 && options.onBlobsWritten) {
    await options.onBlobsWritten({
      blobs: written,
      employeeId: record.principal.employeeId,
      teamId: record.principal.teamId,
      requestId: record.requestId,
    }).catch(() => undefined);
  }
  return target;
}

export function scheduleRequestContextWrite(logger: Logger, record: RequestContextRecord): void {
  void writeRequestContextFile({
    rootDir: env.REQUEST_CONTEXT_DIR,
    timeZone: env.QUOTA_TIMEZONE,
    maxBytes: env.REQUEST_CONTEXT_MAX_BYTES,
    blobMinBytes: env.REQUEST_CONTEXT_BLOB_MIN_BYTES,
    record,
    onBlobsWritten: registerStaticFiles,
  }).catch((err) => {
    logger.error({ err, requestId: record.requestId }, "failed to write request context");
  });
}

/** Best-effort registry index; disk stays the source of truth. */
async function registerStaticFiles(input: {
  blobs: WrittenContextBlob[];
  employeeId: number;
  teamId: number | null;
  requestId: string;
}): Promise<void> {
  const [{ db }, { eq }, schema] = await Promise.all([
    import("../../db/client.js"),
    import("drizzle-orm"),
    import("../../db/schema/index.js"),
  ]);
  const { staticFiles, staticFileOwners } = schema;
  for (const blob of input.blobs) {
    const inserted = await db
      .insert(staticFiles)
      .values({
        sha256: blob.hash,
        kind: blob.kind,
        bytes: blob.bytes,
        mediaType: blob.mediaType ?? null,
        firstRequestId: input.requestId,
      })
      .onConflictDoNothing({ target: staticFiles.sha256 })
      .returning({ id: staticFiles.id });
    let fileId = inserted[0]?.id;
    if (fileId == null) {
      const existing = await db
        .select({ id: staticFiles.id })
        .from(staticFiles)
        .where(eq(staticFiles.sha256, blob.hash))
        .limit(1);
      fileId = existing[0]?.id;
    }
    if (fileId == null) continue;
    await db
      .insert(staticFileOwners)
      .values({ fileId, employeeId: input.employeeId, teamId: input.teamId })
      .onConflictDoNothing();
  }
}

// ---------------------------------------------------------------------------
// Read side: hydrate refs back into the original JSON shape.
// ---------------------------------------------------------------------------

function isBlobRef(value: unknown): value is ContextBlobRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.blob === "string" &&
    BLOB_HASH_RE.test(ref.blob) &&
    (ref.kind === "file" || ref.kind === "block") &&
    typeof ref.bytes === "number"
  );
}

async function readBlobValue(ref: ContextBlobRef, rootDir: string): Promise<unknown> {
  const target = contextBlobFilePath(rootDir, ref.kind, ref.blob);
  const raw = await readFile(target).catch(() => {
    throw new Error(`request context blob missing: ${ref.blob} (${ref.kind})`);
  });
  if (ref.kind === "file") {
    const mediaType = ref.media_type ?? "application/octet-stream";
    const type = mediaType.startsWith("image/") ? "image" : "document";
    return {
      type,
      source: { type: "base64", media_type: mediaType, data: raw.toString("base64") },
    };
  }
  return JSON.parse(gunzipSync(raw).toString("utf8"));
}

async function hydrateContextValue(value: unknown, rootDir: string): Promise<unknown> {
  if (Array.isArray(value)) {
    const out = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i += 1) out[i] = await hydrateContextValue(value[i], rootDir);
    return out;
  }
  if (value && typeof value === "object") {
    if (isBlobRef(value)) return readBlobValue(value, rootDir);
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = await hydrateContextValue(nested, rootDir);
    }
    return out;
  }
  return value;
}

function envelopeStoreRoot(filePath: string): string {
  // format 2 envelopes live at <root>/users/<employeeId>/<quota-day>/<requestId>.json.gz
  return resolve(filePath, "..", "..", "..", "..");
}

export async function readRequestContextRecord(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath);
  const parsed = JSON.parse(gunzipSync(raw).toString("utf8")) as Record<string, unknown>;
  if (parsed?.contextFormat === CONTEXT_FORMAT) {
    return hydrateContextValue(parsed, envelopeStoreRoot(filePath));
  }
  return parsed;
}

/** Inline detail is for the drawer; 50MB reconstructions stay on the download endpoint. */
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

/**
 * Detail-drawer read: hydrate only when the reconstructed size fits the cap,
 * estimated from ref.bytes without touching the content stores. Otherwise the
 * slim envelope itself (refs carry bytes/media_type) is shown.
 */
export async function readRequestContextForDetail(
  filePath: string,
  maxBytes = DETAIL_CONTEXT_MAX_BYTES,
): Promise<{ context: unknown; omittedBodies: boolean }> {
  const raw = await readFile(filePath);
  const parsed = JSON.parse(gunzipSync(raw).toString("utf8")) as Record<string, unknown>;
  if (parsed?.contextFormat !== CONTEXT_FORMAT) {
    return summarizeRequestContextForDetail(parsed, maxBytes);
  }
  let refSurplus = 0;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === "object") {
      if (isBlobRef(value)) {
        refSurplus += Math.max(0, value.bytes - JSON.stringify(value).length);
        return;
      }
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  walk(parsed);
  const estimate = Buffer.byteLength(JSON.stringify(parsed)) + refSurplus;
  if (estimate <= maxBytes) {
    try {
      return { context: await hydrateContextValue(parsed, envelopeStoreRoot(filePath)), omittedBodies: false };
    } catch {
      // A missing blob should not blank the drawer; show the envelope instead.
    }
  }
  const summarized = summarizeRequestContextForDetail(parsed, maxBytes);
  return { context: summarized.context, omittedBodies: true };
}

// ---------------------------------------------------------------------------
// Sanitizing and envelope assembly (unchanged semantics).
// ---------------------------------------------------------------------------

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
