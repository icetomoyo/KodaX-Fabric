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

export function splitHourlyTokens(row: {
  promptTokens: number;
  cacheReadTokens?: number;
  completionTokens: number;
}): { uncachedPrompt: number; cacheRead: number; completion: number } {
  return tokenComposition({
    promptTokens: row.promptTokens,
    cacheReadTokens: row.cacheReadTokens ?? 0,
    completionTokens: row.completionTokens,
  });
}
