import { sql } from "drizzle-orm";
import { requestAudits } from "../db/schema/index.js";

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

function detailsCachedTokens(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return asNonNegativeInt((value as Record<string, unknown>).cached_tokens);
}

/** Anthropic `cache_read_input_tokens` or OpenAI `*.cached_tokens`. */
export function extractCacheReadTokens(usageRaw: unknown): number | null {
  if (!usageRaw || typeof usageRaw !== "object" || Array.isArray(usageRaw)) return null;
  const raw = usageRaw as Record<string, unknown>;
  return (
    asNonNegativeInt(raw.cache_read_input_tokens) ??
    detailsCachedTokens(raw.prompt_tokens_details) ??
    detailsCachedTokens(raw.input_tokens_details)
  );
}

export function billedCacheReadTokens(promptTokens: number, usageRaw: unknown): number {
  const extracted = extractCacheReadTokens(usageRaw);
  if (extracted == null) return 0;
  const prompt = Number.isFinite(promptTokens) && promptTokens > 0 ? Math.trunc(promptTokens) : 0;
  return Math.min(prompt, extracted);
}

/** Null when upstream usage did not report a cache-hit field. */
export const cacheReadTokensNullableSql = sql<number | null>`${requestAudits.cacheReadTokens}`;

export const billedCacheReadTokensSql = sql<number>`least(
  coalesce(${requestAudits.promptTokens}, 0),
  coalesce(${requestAudits.cacheReadTokens}, 0)
)`;

export const billedUncachedPromptTokensSql = sql<number>`greatest(
  0,
  coalesce(${requestAudits.promptTokens}, 0) - ${billedCacheReadTokensSql}
)`;
