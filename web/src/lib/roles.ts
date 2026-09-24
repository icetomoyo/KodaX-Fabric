export type UserRole = "employee" | "admin" | "org_admin" | "dept_admin";

export const ROLE_LABELS: Record<UserRole, string> = {
  employee: "员工",
  admin: "超级管理员",
  org_admin: "企业管理员",
  dept_admin: "部门管理员",
};

export function roleLabel(role: string | null | undefined): string {
  if (role && role in ROLE_LABELS) return ROLE_LABELS[role as UserRole];
  return "员工";
}
