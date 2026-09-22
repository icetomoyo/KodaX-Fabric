import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { sensitiveWordHits, systemSettings } from "../../db/schema/index.js";
import { lookupGlmErrorCatalog } from "../glm-error-codes.js";
import { redis } from "../../redis.js";
import type { RelayProtocol } from "./protocol.js";

export const SENSITIVE_WORDS_SETTING_KEY = "sensitive_words";
export const ZHIPU_SENSITIVE_CONTENT_CODE = "1301";
export const MAX_SENSITIVE_WORD_LENGTH = 64;
export const MAX_SENSITIVE_WORD_COUNT = 10_000;
const CACHE_TTL_MS = 5_000;
/** 单个字符串贡献给扫描文本的上限：超长字符串保留首尾各半，中段不扫描（有界 CPU 的既知取舍）。 */
const MAX_SCAN_STRING_LENGTH = 100_000;
/** 整个请求扫描文本的上限：超出时保留首尾窗口，中间部分不扫描。 */
const MAX_SCAN_TOTAL_LENGTH = 256_000;
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

/** 预归一化词表条目：needle 用于匹配，word 是命中间报与记录用的原始词。 */
export type CompiledSensitiveNeedle = {
  word: string;
  needle: string;
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
  matcher: SensitiveWordMatcher;
};

let cache: CacheEntry | null = null;

/** DB 读失败时的短退避：期间继续用旧缓存，避免每个请求都去打已经故障的库。 */
const STALE_CACHE_RETRY_MS = 2_000;

/**
 * 多实例缓存失效（参考上游 claude-code-hub 的双通道模式）：
 * 管理端改词表/开关后通过 Redis pub/sub 广播，其他实例立即清缓存，
 * 不必等 5 秒 TTL。单实例部署时广播发给自己无害；订阅/发布全部 fail-open，
 * Redis 不可用时退化为纯 TTL，不影响转发。
 */
const CACHE_INVALIDATION_CHANNEL = "kodax:sensitive-words-updated";
let cacheInvalidationSubscriberStarted = false;

function startCacheInvalidationSubscriber(): void {
  if (cacheInvalidationSubscriberStarted) return;
  cacheInvalidationSubscriberStarted = true;
  try {
    const subscriber = redis.duplicate();
    subscriber.on("message", (channel: string) => {
      if (channel !== CACHE_INVALIDATION_CHANNEL) return;
      cache = null;
      hitCountsCache = null;
    });
    void subscriber.subscribe(CACHE_INVALIDATION_CHANNEL).catch((error: unknown) => {
      console.error("[sensitive-words] cache invalidation subscribe failed", error);
    });
  } catch (error) {
    console.error("[sensitive-words] cache invalidation subscriber init failed", error);
  }
}

function broadcastCacheInvalidation(): void {
  void redis.publish(CACHE_INVALIDATION_CHANNEL, "updated").catch(() => {
    // Redis 不可用时依赖各实例的 5 秒 TTL 兜底
  });
}

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
  const texts = extractUserScanTexts(body);
  const needle = word.trim().toLowerCase();
  const haystack = (needle && texts.find((text) => text.toLowerCase().includes(needle)))
    || texts.join("\n…\n");
  if (!haystack) return "";
  if (haystack.length <= MAX_EXCERPT_LENGTH) return haystack;
  const idx = haystack.toLowerCase().indexOf(needle);
  if (idx < 0) {
    const half = Math.floor((MAX_EXCERPT_LENGTH - 3) / 2);
    const fallback = `${haystack.slice(0, half)}\n…\n${haystack.slice(-half)}`;
    return fallback.length <= MAX_EXCERPT_LENGTH ? fallback : fallback.slice(0, MAX_EXCERPT_LENGTH);
  }
  const radius = Math.max(0, Math.floor((MAX_EXCERPT_LENGTH - needle.length - 2) / 2));
  const start = Math.max(0, idx - radius);
  const end = Math.min(haystack.length, idx + needle.length + radius);
  let excerpt = haystack.slice(start, end);
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < haystack.length) excerpt = `${excerpt}…`;
  return excerpt.length <= MAX_EXCERPT_LENGTH ? excerpt : excerpt.slice(0, MAX_EXCERPT_LENGTH);
}

export function requestPreviewForSensitiveHit(body: unknown): unknown {
  const truncated = truncatePreviewValue(body);
  try {
    const json = JSON.stringify(truncated);
    if (json.length <= MAX_PREVIEW_JSON) return truncated;
    return { truncated: true, text: json.slice(0, MAX_PREVIEW_JSON) };
  } catch {
    return { truncated: true, text: safePreviewText(body) };
  }
}

function safePreviewText(body: unknown): string {
  try {
    return JSON.stringify(body)?.slice(0, MAX_PREVIEW_JSON) ?? "";
  } catch {
    return "";
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
  hitCountsCache = null;
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
  return compileSensitiveWords(words).map((item) => item.word);
}

/**
 * 预归一化词表：NFC / 零宽字符 / 空白 / 大小写转换一次付清，
 * 请求热路径只做 includes，不再逐请求重算词表。
 */
export function compileSensitiveWords(words: unknown[]): CompiledSensitiveNeedle[] {
  const seen = new Set<string>();
  const out: CompiledSensitiveNeedle[] = [];
  for (const raw of words) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > MAX_SENSITIVE_WORD_LENGTH) continue;
    const needle = normalizeSensitiveNeedle(trimmed);
    if (!needle || seen.has(needle)) continue;
    seen.add(needle);
    out.push({ word: trimmed, needle });
  }
  return out;
}

/**
 * 预编译匹配器：词表归一化 + AC 自动机在缓存构建时一次完成，
 * 热路径按文本长度线性匹配，成本与词数无关（1 万词 × 256K 文本仍在毫秒级）。
 */
export type SensitiveWordMatcher = {
  needles: readonly CompiledSensitiveNeedle[];
  match(haystack: string): string | null;
};

export function buildSensitiveWordMatcher(words: unknown[]): SensitiveWordMatcher {
  const needles = compileSensitiveWords(words);
  const nodes = buildAhoCorasick(needles);
  return {
    needles,
    match(haystack: string): string | null {
      return acMatch(normalizeSensitiveNeedle(haystack), nodes);
    },
  };
}

/**
 * 提取参与敏感词扫描的用户消息文本段（2026-09-22 口径决策：只扫 role=user）。
 * 检测对象是员工输入——敏感词进入对话的源头必然经过 user 消息；system 是客户端模板、
 * assistant 历史与 tools/metadata 不属于员工输入，不进扫描（同时消除长对话重复命中）。
 * 每段独立扫描、互不拼接：跨字段粘接不再可能产生误报；段与段之间也不存在
 * 「空格插空规避」的兼容问题（该规避发生在单段文本内部，分段后仍然命中）。
 * 已知并接受的残留缺口：诱导模型产出敏感内容后藏于 assistant 历史，不在扫描范围。
 */
export function extractUserScanTexts(body: unknown): string[] {
  const texts: string[] = [];
  if (!body || typeof body !== "object") return texts;
  const record = body as Record<string, unknown>;
  if (typeof record.input === "string") {
    pushScanText(record.input, texts);
  }
  for (const key of ["messages", "input"] as const) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    for (const message of list) {
      if (!message || typeof message !== "object" || Array.isArray(message)) continue;
      if ((message as Record<string, unknown>).role !== "user") continue;
      pushMessageContent((message as Record<string, unknown>).content, texts);
    }
  }
  return capScanTexts(texts);
}

function pushMessageContent(content: unknown, texts: string[]): void {
  if (typeof content === "string") {
    pushScanText(content, texts);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block === "string") {
      pushScanText(block, texts);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    const blockRecord = block as Record<string, unknown>;
    // 只取文本字段：image_url 等其他 block 天然不进扫描（base64 误报源头）
    if (typeof blockRecord.text === "string") pushScanText(blockRecord.text, texts);
    else if (typeof blockRecord.content === "string") pushScanText(blockRecord.content, texts);
  }
}

function pushScanText(text: string, texts: string[]): void {
  if (text.length > 0) texts.push(truncateForScan(text));
}

/** 段级总量上限：超限时保留首尾窗口（段间独立匹配，无需分隔符防粘接）。 */
function capScanTexts(texts: string[]): string[] {
  let total = 0;
  for (const text of texts) total += text.length;
  if (total <= MAX_SCAN_TOTAL_LENGTH) return texts;
  const half = Math.floor(MAX_SCAN_TOTAL_LENGTH / 2);
  const head: string[] = [];
  let headLength = 0;
  for (const text of texts) {
    if (headLength + text.length > half) {
      const remaining = half - headLength;
      if (remaining > 0) head.push(text.slice(0, remaining));
      break;
    }
    head.push(text);
    headLength += text.length;
  }
  const tail: string[] = [];
  let tailLength = 0;
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const text = texts[i];
    if (tailLength + text.length > half) {
      const remaining = half - tailLength;
      if (remaining > 0) tail.unshift(text.slice(-remaining));
      break;
    }
    tail.unshift(text);
    tailLength += text.length;
  }
  return [...head, ...tail];
}

export function findSensitiveWord(haystack: string, words: string[]): string | null {
  return buildSensitiveWordMatcher(words).match(haystack);
}

export function findSensitiveWordInRequest(body: unknown, words: string[]): string | null {
  if (words.length === 0) return null;
  const matcher = buildSensitiveWordMatcher(words);
  for (const text of extractUserScanTexts(body)) {
    const word = matcher.match(text);
    if (word) return word;
  }
  return null;
}

export async function loadSensitiveWordsConfig(): Promise<SensitiveWordsConfig> {
  return (await loadSensitiveWordsCacheEntry()).config;
}

async function loadSensitiveWordsCacheEntry(): Promise<CacheEntry> {
  startCacheInvalidationSubscriber();
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache;
  try {
    const config = await readConfigFromDb();
    cache = buildCacheEntry(config, now);
    return cache;
  } catch (error) {
    // fail-open：配置表暂时读不到时降级用旧缓存（词表/开关保持最后一次已知状态），
    // 只有从未成功加载过才把错误抛回请求方。
    if (cache) {
      console.error("[sensitive-words] config load failed, serving stale cache", error);
      cache = { ...cache, expiresAt: now + STALE_CACHE_RETRY_MS };
      return cache;
    }
    throw error;
  }
}

/** 缓存条目整体构建、整体替换：config 与 matcher 必须同源，读侧不能看到半套规则。 */
function buildCacheEntry(config: SensitiveWordsConfig, now: number): CacheEntry {
  return {
    config,
    matcher: buildSensitiveWordMatcher(config.words),
    expiresAt: now + CACHE_TTL_MS,
  };
}

export async function evaluateSensitiveRequest(
  body: unknown,
): Promise<SensitiveRequestEvaluation | null> {
  const { config, matcher } = await loadSensitiveWordsCacheEntry();
  if (!config.detectEnabled || matcher.needles.length === 0) {
    return null;
  }
  for (const text of extractUserScanTexts(body)) {
    const word = matcher.match(text);
    if (word) {
      return {
        word,
        record: true,
        intercept: config.interceptEnabled,
      };
    }
  }
  return null;
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
  const counts = await loadHitCounts();
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

type HitCountsCache = { expiresAt: number; counts: Map<string, number> };
const HIT_COUNTS_TTL_MS = 30_000;
let hitCountsCache: HitCountsCache | null = null;

/**
 * 命中计数是对只增不减流水表的全表 GROUP BY，管理页每次分页都拉一遍会随表增长变慢；
 * 短 TTL 缓存 + 命中写入时失效，管理端最多滞后 30 秒看到新命中。
 */
async function loadHitCounts(): Promise<Map<string, number>> {
  if (hitCountsCache && hitCountsCache.expiresAt > Date.now()) return hitCountsCache.counts;
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
  hitCountsCache = { counts, expiresAt: Date.now() + HIT_COUNTS_TTL_MS };
  return counts;
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
  cache = buildCacheEntry(next, Date.now());
  broadcastCacheInvalidation();
  return next;
}

function truncateForScan(text: string): string {
  if (text.length <= MAX_SCAN_STRING_LENGTH) return text;
  const half = Math.floor(MAX_SCAN_STRING_LENGTH / 2);
  return `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
}

type AcNode = { next: Map<string, number>; fail: number; words: string[] };

/** Aho-Corasick：多模式串单趟匹配。词与文本都按 Unicode 码点切分，代理对不会拆开。 */
function buildAhoCorasick(needles: readonly CompiledSensitiveNeedle[]): AcNode[] {
  const nodes: AcNode[] = [{ next: new Map(), fail: 0, words: [] }];
  for (const { word, needle } of needles) {
    let current = 0;
    for (const ch of needle) {
      let child = nodes[current].next.get(ch);
      if (child === undefined) {
        child = nodes.length;
        nodes[current].next.set(ch, child);
        nodes.push({ next: new Map(), fail: 0, words: [] });
      }
      current = child;
    }
    nodes[current].words.push(word);
  }
  const queue: number[] = [];
  for (const child of nodes[0].next.values()) {
    queue.push(child);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    for (const [ch, child] of nodes[current].next) {
      queue.push(child);
      let fail = nodes[current].fail;
      while (fail !== 0 && !nodes[fail].next.has(ch)) fail = nodes[fail].fail;
      const target = nodes[fail].next.get(ch);
      nodes[child].fail = target !== undefined && target !== child ? target : 0;
      const suffixWords = nodes[nodes[child].fail].words;
      if (suffixWords.length > 0) {
        nodes[child].words = [...nodes[child].words, ...suffixWords];
      }
    }
  }
  return nodes;
}

/** 返回文本中最早出现的命中词（位置优先，同位置不区分先后）。 */
function acMatch(normalizedText: string, nodes: readonly AcNode[]): string | null {
  let current = 0;
  for (const ch of normalizedText) {
    let next = nodes[current].next.get(ch);
    while (next === undefined && current !== 0) {
      current = nodes[current].fail;
      next = nodes[current].next.get(ch);
    }
    current = next ?? 0;
    const words = nodes[current].words;
    if (words.length > 0) return words[0];
  }
  return null;
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
