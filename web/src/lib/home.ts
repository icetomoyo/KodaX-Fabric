import type { User } from "@/stores/auth";

/**
 * Default landing path after login.
 * Admins/auditors land in the console, but may manually switch to /me
 * (they are still employees with personal API keys and usage).
 */
export function homePathForUser(user: Pick<User, "role"> | null | undefined): string {
  if (!user) return "/login";
  if (user.role === "admin" || user.role === "auditor") return "/admin";
  return "/me";
}

export function canUseAdminConsole(user: Pick<User, "role"> | null | undefined): boolean {
  return user?.role === "admin" || user?.role === "auditor";
}

export function canUseEmployeeWorkspace(user: Pick<User, "role"> | null | undefined): boolean {
  // Every active account is an employee; admin/auditor may also enter /me.
  return Boolean(user);
}
