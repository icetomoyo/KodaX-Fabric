import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { sensitiveWordHits, systemSettings } from "../../db/schema/index.js";
import { lookupGlmErrorCatalog } from "../glm-error-codes.js";
import type { RelayProtocol } from "./protocol.js";

export const SENSITIVE_WORDS_SETTING_KEY = "sensitive_words";
export const ZHIPU_SENSITIVE_CONTENT_CODE = "1301";
export const MAX_SENSITIVE_WORD_LENGTH = 64;
export const MAX_SENSITIVE_WORD_COUNT = 10_000;
const CACHE_TTL_MS = 5_000;
const MAX_SCAN_STRING_LENGTH = 100_000;
const MAX_EXCERPT_LENGTH = 4_000;
const MAX_PREVIEW_STRING = 2_000;
const MAX_PREVIEW_JSON = 32_768;
const ZHIPU_SENSITIVE_CONTENT_MESSAGE =
  "系统检测到输入或生成内容可能包含不安全或敏感内容，请您避免输入易产生敏感内容的提示语，感谢您的配合";

export type SensitiveWordsConfig = {
  detectEnabled: boolean;
  interceptEnabled: boolean;
  words: string[];
};

export type SensitiveRequestEvaluation = {
  word: string;
  record: boolean;
  intercept: boolean;
};

export type SensitiveWordRow = {
  word: string;
  hitCount: number;
};

export type SensitiveWordImportResult = SensitiveWordsConfig & {
  added: number;
  skipped: number;
};

export type SensitiveWordListQuery = {
  limit: number;
  offset: number;
  sort: "hitCount" | "word";
  order: "asc" | "desc";
};

export class SensitiveWordsError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SensitiveWordsError";
    this.status = status;
  }
}

type CacheEntry = {
  expiresAt: number;
  config: SensitiveWordsConfig;
};

let cache: CacheEntry | null = null;

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00AD]/g;

export function zhipuSensitiveContentError(): {
  httpStatus: number;
  code: string;
  message: string;
} {
  const entry = lookupGlmErrorCatalog(ZHIPU_SENSITIVE_CONTENT_CODE);
  return {
    httpStatus: entry?.httpStatus ?? 400,
    code: ZHIPU_SENSITIVE_CONTENT_CODE,
    message: entry?.message ?? ZHIPU_SENSITIVE_CONTENT_MESSAGE,
  };
}

export function excerptForSensitiveHit(body: unknown, word: string): string {
  const text = collectRequestText(body);
  if (!text) return "";
  if (text.length <= MAX_EXCERPT_LENGTH) return text;
  const needle = word.trim();
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) {
    const half = Math.floor((MAX_EXCERPT_LENGTH - 3) / 2);
    const fallback = `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
    return fallback.length <= MAX_EXCERPT_LENGTH ? fallback : fallback.slice(0, MAX_EXCERPT_LENGTH);
  }
  const radius = Math.max(0, Math.floor((MAX_EXCERPT_LENGTH - needle.length - 2) / 2));
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  let excerpt = text.slice(start, end);
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < text.length) excerpt = `${excerpt}…`;
  return excerpt.length <= MAX_EXCERPT_LENGTH ? excerpt : excerpt.slice(0, MAX_EXCERPT_LENGTH);
}

export function requestPreviewForSensitiveHit(body: unknown): unknown {
  const truncated = truncatePreviewValue(body);
  try {
    const json = JSON.stringify(truncated);
    if (json.length <= MAX_PREVIEW_JSON) return truncated;
    return { truncated: true, text: json.slice(0, MAX_PREVIEW_JSON) };
  } catch {
    return { truncated: true, text: collectRequestText(body).slice(0, MAX_PREVIEW_JSON) };
  }
}

export type SensitiveWordHitAction = "detect" | "intercept";

export async function recordSensitiveWordHit(input: {
  requestId: string;
  employeeId: number;
  employeeApiKeyId?: number | null;
  teamId?: number | null;
  clientModel: string;
  protocol: RelayProtocol;
  path: string;
  matchedWord: string;
  action: SensitiveWordHitAction;
  requestBody: unknown;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<void> {
  await db
    .insert(sensitiveWordHits)
    .values({
      requestId: input.requestId.slice(0, 64),
      employeeId: input.employeeId,
      employeeApiKeyId: input.employeeApiKeyId ?? null,
      teamId: input.teamId ?? null,
      clientModel: input.clientModel.slice(0, 128),
      protocol: input.protocol,
      path: input.path.slice(0, 256),
      matchedWord: input.matchedWord.slice(0, MAX_SENSITIVE_WORD_LENGTH),
      action: input.action,
      excerpt: excerptForSensitiveHit(input.requestBody, input.matchedWord),
      requestPreview: requestPreviewForSensitiveHit(input.requestBody),
      userAgent: input.userAgent?.slice(0, 512) || null,
      ip: input.ip?.slice(0, 64) || null,
    })
    .onConflictDoNothing();
}

export function normalizeSensitiveNeedle(word: string): string {
  return word.normalize("NFC").replace(ZERO_WIDTH, "").replace(/\s+/g, "").toLowerCase();
}

export function resolveSensitiveWordFlags(input: {
  detectEnabled: boolean;
  interceptEnabled: boolean;
}): Pick<SensitiveWordsConfig, "detectEnabled" | "interceptEnabled"> {
  if (input.interceptEnabled) {
    return { detectEnabled: true, interceptEnabled: true };
  }
  return { detectEnabled: input.detectEnabled, interceptEnabled: false };
}

export function patchSensitiveWordFlags(
  current: Pick<SensitiveWordsConfig, "detectEnabled" | "interceptEnabled">,
  patch: { detectEnabled?: boolean; interceptEnabled?: boolean },
): Pick<SensitiveWordsConfig, "detectEnabled" | "interceptEnabled"> {
  if (patch.interceptEnabled === true) {
    return { detectEnabled: true, interceptEnabled: true };
  }
  if (patch.detectEnabled === false) {
    return { detectEnabled: false, interceptEnabled: false };
  }
  return resolveSensitiveWordFlags({
    detectEnabled: patch.detectEnabled ?? current.detectEnabled,
    interceptEnabled: patch.interceptEnabled ?? current.interceptEnabled,
  });
}

export function parseSensitiveWordsConfig(value: unknown): SensitiveWordsConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { detectEnabled: true, interceptEnabled: false, words: [] };
  }
  const record = value as {
    enabled?: unknown;
    detectEnabled?: unknown;
    interceptEnabled?: unknown;
    words?: unknown;
  };
  const detectEnabled =
    record.detectEnabled === false
      ? false
      : record.detectEnabled === true
        ? true
        : record.enabled !== false;
  const interceptEnabled = record.interceptEnabled === true;
  return {
    ...resolveSensitiveWordFlags({ detectEnabled, interceptEnabled }),
    words: uniqueWords(Array.isArray(record.words) ? record.words : []),
  };
}

export function sortSensitiveWordRows(
  items: SensitiveWordRow[],
  sort: SensitiveWordListQuery["sort"],
  order: SensitiveWordListQuery["order"],
): SensitiveWordRow[] {
  const direction = order === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    if (sort === "hitCount" && left.hitCount !== right.hitCount) {
      return (left.hitCount - right.hitCount) * direction;
    }
    return left.word.localeCompare(right.word, "zh") * (sort === "word" ? direction : 1);
  });
}

export function uniqueWords(words: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > MAX_SENSITIVE_WORD_LENGTH) continue;
    const key = normalizeSensitiveNeedle(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function collectRequestText(body: unknown): string {
  const parts: string[] = [];
  collectStrings(body, parts);
  return parts.join("\n");
}

export function findSensitiveWord(haystack: string, words: string[]): string | null {
  const normalizedHaystack = normalizeSensitiveNeedle(haystack);
  if (!normalizedHaystack) return null;
  for (const word of uniqueWords(words)) {
    const needle = normalizeSensitiveNeedle(word);
    if (needle && normalizedHaystack.includes(needle)) return word;
  }
  return null;
}

export function findSensitiveWordInRequest(body: unknown, words: string[]): string | null {
  if (words.length === 0) return null;
  return findSensitiveWord(collectRequestText(body), words);
}

export function invalidateSensitiveWordsCache(): void {
  cache = null;
}

export async function loadSensitiveWordsConfig(): Promise<SensitiveWordsConfig> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.config;
  const config = await readConfigFromDb();
  cache = { config, expiresAt: now + CACHE_TTL_MS };
  return config;
}

export async function findSensitiveHit(body: unknown): Promise<string | null> {
  const hit = await evaluateSensitiveRequest(body);
  return hit?.word ?? null;
}

export async function evaluateSensitiveRequest(
  body: unknown,
): Promise<SensitiveRequestEvaluation | null> {
  const config = await loadSensitiveWordsConfig();
  if (!config.detectEnabled || config.words.length === 0) {
    return null;
  }
  const word = findSensitiveWordInRequest(body, config.words);
  if (!word) return null;
  return {
    word,
    record: true,
    intercept: config.interceptEnabled,
  };
}

export async function addSensitiveWord(word: string): Promise<SensitiveWordsConfig> {
  const trimmed = word.trim();
  if (!trimmed) {
    throw new SensitiveWordsError(400, "敏感词不能为空");
  }
  if (trimmed.length > MAX_SENSITIVE_WORD_LENGTH) {
    throw new SensitiveWordsError(400, `敏感词不能超过 ${MAX_SENSITIVE_WORD_LENGTH} 个字符`);
  }
  const key = normalizeSensitiveNeedle(trimmed);
  if (!key) {
    throw new SensitiveWordsError(400, "敏感词不能为空");
  }
  const current = await readConfigFromDb();
  if (current.words.some((item) => normalizeSensitiveNeedle(item) === key)) {
    throw new SensitiveWordsError(409, "该敏感词已存在");
  }
  if (current.words.length >= MAX_SENSITIVE_WORD_COUNT) {
    throw new SensitiveWordsError(400, `敏感词最多 ${MAX_SENSITIVE_WORD_COUNT} 个`);
  }
  return writeConfig({ ...current, words: [...current.words, trimmed] });
}

export async function addSensitiveWords(words: string[]): Promise<SensitiveWordImportResult> {
  const incoming = uniqueWords(words);
  if (incoming.length === 0) {
    throw new SensitiveWordsError(400, "文档里没有可用的敏感词");
  }
  const current = await readConfigFromDb();
  const existing = new Set(current.words.map((item) => normalizeSensitiveNeedle(item)));
  const fresh = incoming.filter((item) => !existing.has(normalizeSensitiveNeedle(item)));
  if (current.words.length + fresh.length > MAX_SENSITIVE_WORD_COUNT) {
    throw new SensitiveWordsError(400, `敏感词最多 ${MAX_SENSITIVE_WORD_COUNT} 个`);
  }
  const next = fresh.length ? await writeConfig({ ...current, words: [...current.words, ...fresh] }) : current;
  return {
    ...next,
    added: fresh.length,
    skipped: incoming.length - fresh.length,
  };
}

export async function listSensitiveWords(query: SensitiveWordListQuery): Promise<{
  detectEnabled: boolean;
  interceptEnabled: boolean;
  total: number;
  items: SensitiveWordRow[];
}> {
  const config = await loadSensitiveWordsConfig();
  const countRows = await db
    .select({
      word: sensitiveWordHits.matchedWord,
      n: sql<number>`count(*)::int`,
    })
    .from(sensitiveWordHits)
    .groupBy(sensitiveWordHits.matchedWord);
  const counts = new Map<string, number>();
  for (const row of countRows) {
    const key = normalizeSensitiveNeedle(row.word);
    counts.set(key, (counts.get(key) ?? 0) + Number(row.n));
  }
  const ranked = sortSensitiveWordRows(
    config.words.map((word) => ({
      word,
      hitCount: counts.get(normalizeSensitiveNeedle(word)) ?? 0,
    })),
    query.sort,
    query.order,
  );
  return {
    detectEnabled: config.detectEnabled,
    interceptEnabled: config.interceptEnabled,
    total: ranked.length,
    items: ranked.slice(query.offset, query.offset + query.limit),
  };
}

export async function removeSensitiveWord(word: string): Promise<SensitiveWordsConfig> {
  const key = normalizeSensitiveNeedle(word.trim());
  if (!key) throw new SensitiveWordsError(400, "敏感词不能为空");
  const current = await readConfigFromDb();
  const words = current.words.filter((item) => normalizeSensitiveNeedle(item) !== key);
  if (words.length === current.words.length) {
    throw new SensitiveWordsError(404, "敏感词不存在");
  }
  return writeConfig({ ...current, words });
}

export async function updateSensitiveWordFlags(patch: {
  detectEnabled?: boolean;
  interceptEnabled?: boolean;
}): Promise<SensitiveWordsConfig> {
  const current = await readConfigFromDb();
  return writeConfig({
    ...current,
    ...patchSensitiveWordFlags(current, patch),
  });
}

export async function setSensitiveWordsEnabled(enabled: boolean): Promise<SensitiveWordsConfig> {
  return updateSensitiveWordFlags({ interceptEnabled: enabled });
}

async function readConfigFromDb(): Promise<SensitiveWordsConfig> {
  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, SENSITIVE_WORDS_SETTING_KEY))
    .limit(1);
  return parseSensitiveWordsConfig(row?.value);
}

async function writeConfig(config: SensitiveWordsConfig): Promise<SensitiveWordsConfig> {
  const next: SensitiveWordsConfig = {
    ...resolveSensitiveWordFlags(config),
    words: uniqueWords(config.words),
  };
  const now = new Date();
  await db
    .insert(systemSettings)
    .values({
      key: SENSITIVE_WORDS_SETTING_KEY,
      value: next,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: next,
        updatedAt: now,
      },
    });
  cache = { config: next, expiresAt: Date.now() + CACHE_TTL_MS };
  return next;
}

function collectStrings(value: unknown, parts: string[]): void {
  if (typeof value === "string") {
    if (value.length > 0 && value.length <= MAX_SCAN_STRING_LENGTH) parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, parts);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectStrings(item, parts);
  }
}

function truncatePreviewValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length <= MAX_PREVIEW_STRING ? value : `${value.slice(0, MAX_PREVIEW_STRING)}…`;
  }
  if (Array.isArray(value)) return value.map((item) => truncatePreviewValue(item));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = truncatePreviewValue(item);
  }
  return out;
}
