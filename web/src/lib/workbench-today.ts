function roundPercent(value: number): number {
  return Math.round(value * 100);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function quotaDayAt(date: Date, timeZone = "Asia/Shanghai"): string {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addCalendarDays(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid date: ${value}`);
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const next = new Date(utc + days * 86_400_000);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function analysisWindow(
  preset: "7d" | "30d",
  now = new Date(),
  timeZone = "Asia/Shanghai",
): { from: string; to: string } {
  const to = quotaDayAt(now, timeZone);
  const span = preset === "7d" ? 7 : 30;
  return { from: addCalendarDays(to, -(span - 1)), to };
}

export function formatChangeFoot(change: number | null | undefined, comparedTo = "较昨天"): string {
  if (change == null || !Number.isFinite(change)) return `${comparedTo} —`;
  const pct = roundPercent(change);
  if (pct === 0) return `${comparedTo}持平`;
  return pct > 0 ? `${comparedTo} +${pct}%` : `${comparedTo} ${pct}%`;
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${roundPercent(rate)}%`;
}
