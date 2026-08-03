import type { User } from "@/stores/auth";

/** Landing path by role: admin stays in admin console only. */
export function homePathForUser(user: Pick<User, "role"> | null | undefined): string {
  if (!user) return "/login";
  if (user.role === "admin" || user.role === "auditor") return "/admin";
  return "/me";
}
