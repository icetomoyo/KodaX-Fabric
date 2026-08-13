/** Pool group_name stored as English; UI shows Chinese. */
export const POOL_GROUPS = [
  { value: "premium", label: "优质", hint: "高优先、低延迟" },
  { value: "standard", label: "标准", hint: "日常默认" },
  { value: "bulk", label: "跑批", hint: "低成本、量大" },
] as const;

export function poolGroupLabel(g?: string | null): string {
  const hit = POOL_GROUPS.find((x) => x.value === g);
  if (!hit) return g || "—";
  return `${hit.label}（${hit.hint}）`;
}
