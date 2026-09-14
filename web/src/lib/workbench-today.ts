function roundPercent(value: number): number {
  return Math.round(value * 100);
}

export function formatChangeFoot(change: number | null | undefined): string {
  if (change == null || !Number.isFinite(change)) return "较昨天 —";
  const pct = roundPercent(change);
  if (pct === 0) return "较昨天持平";
  return pct > 0 ? `较昨天 +${pct}%` : `较昨天 ${pct}%`;
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${roundPercent(rate)}%`;
}
