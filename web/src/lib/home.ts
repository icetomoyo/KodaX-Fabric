import type { User } from "@/stores/auth";

/** Default landing path after login. */
export function homePathForUser(user: Pick<User, "role"> | null | undefined): string {
  if (!user) return "/login";
  if (user.role === "admin") return "/admin";
  if (user.role === "org_admin") return "/admin/users";
  if (user.role === "team_admin") return "/admin/teams";
  return "/me";
}

export function canUseAdminConsole(user: Pick<User, "role"> | null | undefined): boolean {
  return user?.role === "admin" || user?.role === "org_admin" || user?.role === "team_admin";
}

export function canUseEmployeeWorkspace(user: Pick<User, "role"> | null | undefined): boolean {
  return user?.role === "employee";
}
