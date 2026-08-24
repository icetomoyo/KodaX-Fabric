const numberFormatter = new Intl.NumberFormat("zh-CN");

/** Thousand-separated token count, e.g. 1,250,000. */
export function formatTokenCount(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return numberFormatter.format(n);
}

/** Compact token count using 万 / 亿 for large values. */
export function formatTokenCompact(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 100_000_000) return `${trimFraction(n / 100_000_000)} 亿`;
  if (abs >= 10_000) return `${trimFraction(n / 10_000)} 万`;
  return formatTokenCount(n);
}

export function usagePercent(used: number, quota: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(quota) || quota <= 0) return 0;
  return Math.min(100, Math.round((used / quota) * 1000) / 10);
}

export function usageProgressStatus(
  used: number,
  quota: number,
): "warning" | "exception" | undefined {
  const percent = usagePercent(used, quota);
  if (percent >= 100) return "exception";
  if (percent >= 80) return "warning";
  return undefined;
}

function trimFraction(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Display CNY as ¥12.35. Accepts API decimal strings. */
export function formatYuan(
  value: string | number | null | undefined,
  fractionDigits = 2,
): string {
  const raw = value == null ? "" : String(value).trim();
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) {
    return `¥${(0).toFixed(fractionDigits)}`;
  }
  return `¥${n.toLocaleString("zh-CN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}
