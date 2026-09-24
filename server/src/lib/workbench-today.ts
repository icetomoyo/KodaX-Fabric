export function percentChange(today: number, yesterday: number): number | null {
  if (!Number.isFinite(today) || !Number.isFinite(yesterday) || yesterday === 0) return null;
  return (today - yesterday) / yesterday;
}

export function cacheHitRate(cacheReadTokens: number, promptTokens: number): number | null {
  if (!Number.isFinite(cacheReadTokens) || !Number.isFinite(promptTokens) || promptTokens <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, cacheReadTokens / promptTokens));
}

export function avgTokensPerRequest(totalTokens: number, requestCount: number): number | null {
  if (!Number.isFinite(totalTokens) || !Number.isFinite(requestCount) || requestCount <= 0) {
    return null;
  }
  return totalTokens / requestCount;
}

export function peakHour(
  trend: ReadonlyArray<{ day: string; totalTokens: number }>,
): { bucket: string; hour: string; totalTokens: number } | null {
  let best: { day: string; totalTokens: number } | null = null;
  for (const row of trend) {
    const totalTokens = Number(row.totalTokens) || 0;
    if (totalTokens <= 0) continue;
    if (!best || totalTokens > best.totalTokens) best = { day: row.day, totalTokens };
  }
  if (!best) return null;
  return {
    bucket: best.day,
    hour: best.day.slice(-5),
    totalTokens: best.totalTokens,
  };
}

export function tokenComposition(input: {
  promptTokens: number;
  cacheReadTokens: number;
  completionTokens: number;
}): { uncachedPrompt: number; cacheRead: number; completion: number } {
  const prompt = Math.max(0, Number(input.promptTokens) || 0);
  const cacheRead = Math.min(prompt, Math.max(0, Number(input.cacheReadTokens) || 0));
  return {
    uncachedPrompt: prompt - cacheRead,
    cacheRead,
    completion: Math.max(0, Number(input.completionTokens) || 0),
  };
}

export function canonicalizeClientModel(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim().toLowerCase();
  return trimmed || "unknown";
}

export function modelUsageRanks(
  rows: ReadonlyArray<{ key: string; totalTokens: number; requestCount: number }>,
  totals: { totalTokens: number; requestCount: number },
  limit = 12,
): Array<{ key: string; totalTokens: number; requestCount: number }> {
  const merged = new Map<string, { key: string; totalTokens: number; requestCount: number }>();
  for (const row of rows) {
    const key = canonicalizeClientModel(row.key);
    const totalTokens = Math.max(0, Number(row.totalTokens) || 0);
    const requestCount = Math.max(0, Number(row.requestCount) || 0);
    const current = merged.get(key);
    if (current) {
      current.totalTokens += totalTokens;
      current.requestCount += requestCount;
    } else {
      merged.set(key, { key, totalTokens, requestCount });
    }
  }
  const top = [...merged.values()]
    .filter((row) => row.totalTokens > 0)
    .sort((left, right) => right.totalTokens - left.totalTokens || left.key.localeCompare(right.key))
    .slice(0, limit);
  const shownTokens = top.reduce((sum, row) => sum + row.totalTokens, 0);
  const leftoverTokens = Math.max(0, (Number(totals.totalTokens) || 0) - shownTokens);
  if (leftoverTokens <= 0) return top;
  const shownRequests = top.reduce((sum, row) => sum + row.requestCount, 0);
  top.push({
    key: "other",
    totalTokens: leftoverTokens,
    requestCount: Math.max(0, (Number(totals.requestCount) || 0) - shownRequests),
  });
  return top;
}
