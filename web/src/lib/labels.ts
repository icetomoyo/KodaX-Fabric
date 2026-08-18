/** Pool group_name stored as English; UI shows Chinese. */
export const POOL_GROUPS = [
  { value: "premium", label: "优质", hint: "高优先、低延迟" },
  { value: "standard", label: "标准", hint: "日常默认" },
  { value: "bulk", label: "跑批", hint: "低成本、量大" },
] as const;

export const ROLES = [
  { value: "super_admin", label: "超级管理员" },
  { value: "enterprise_admin", label: "企业管理员" },
  { value: "org_admin", label: "企业管理员" },
  { value: "team_admin", label: "团队管理员" },
  { value: "developer", label: "开发者" },
] as const;

export function roleLabel(role?: string | null): string {
  if (role === "admin") return "企业管理员";
  const hit = ROLES.find((x) => x.value === role);
  return hit?.label || role || "—";
}

export function isOrgAdmin(role?: string | null): boolean {
  return role === "enterprise_admin" || role === "org_admin" || role === "admin";
}

export function isTeamAdmin(role?: string | null): boolean {
  return role === "team_admin";
}

export function poolGroupLabel(g?: string | null): string {
  const hit = POOL_GROUPS.find((x) => x.value === g);
  if (!hit) return g || "—";
  return `${hit.label}（${hit.hint}）`;
}
