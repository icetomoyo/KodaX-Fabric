export type UserRole = "employee" | "admin" | "org_admin" | "team_admin";

export const ROLE_LABELS: Record<UserRole, string> = {
  employee: "员工",
  admin: "超级管理员",
  org_admin: "企业管理员",
  team_admin: "团队管理员",
};

export function roleLabel(role: string | null | undefined): string {
  if (role && role in ROLE_LABELS) return ROLE_LABELS[role as UserRole];
  return "员工";
}

export function isSuperAdminRole(role: string | null | undefined): boolean {
  return role === "admin";
}

export function isOrgAdminRole(role: string | null | undefined): boolean {
  return role === "org_admin";
}

export function canUseAdminConsoleRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "org_admin" || role === "team_admin";
}
