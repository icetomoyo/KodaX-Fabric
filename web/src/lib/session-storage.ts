export const TOKEN_KEY = "th_token";
export const USER_KEY = "th_user";
export const ACT_AS_KEY = "th_act_as";

const SESSION_ROLES = ["employee", "admin", "org_admin", "dept_admin", "team_admin"] as const;
const ACT_AS_ROLES = ["org_admin", "dept_admin", "team_admin", "employee"] as const;

function isSessionRole(value: unknown): value is (typeof SESSION_ROLES)[number] {
  return typeof value === "string" && (SESSION_ROLES as readonly string[]).includes(value);
}

function isActAsRole(value: unknown): value is (typeof ACT_AS_ROLES)[number] {
  return typeof value === "string" && (ACT_AS_ROLES as readonly string[]).includes(value);
}

export function parseStoredUser(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    if (typeof row.id !== "number" || !Number.isFinite(row.id) || !isSessionRole(row.role)) {
      return null;
    }
    return row;
  } catch {
    return null;
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(b64), (char) => char.charCodeAt(0)),
    );
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseStoredActAs(raw: string | null): {
  role: (typeof ACT_AS_ROLES)[number];
  enterpriseId: number;
  departmentId?: number;
  teamId?: number;
  employeeId?: number;
} | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    if (!isActAsRole(row.role) || typeof row.enterpriseId !== "number") return null;
    return {
      role: row.role,
      enterpriseId: row.enterpriseId,
      departmentId: typeof row.departmentId === "number" ? row.departmentId : undefined,
      teamId: typeof row.teamId === "number" ? row.teamId : undefined,
      employeeId: typeof row.employeeId === "number" ? row.employeeId : undefined,
    };
  } catch {
    return null;
  }
}

export function readStoredSession(): {
  token: string | null;
  user: Record<string, unknown> | null;
  actAs: ReturnType<typeof parseStoredActAs>;
} {
  const token = localStorage.getItem(TOKEN_KEY);
  let user = parseStoredUser(localStorage.getItem(USER_KEY));
  let actAs = parseStoredActAs(localStorage.getItem(ACT_AS_KEY));
  if (!token || !user) {
    if (token || user || actAs) clearStoredSession();
    return { token: null, user: null, actAs: null };
  }

  const payload = decodeJwtPayload(token);
  if (!payload) {
    clearStoredSession();
    return { token: null, user: null, actAs: null };
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
    clearStoredSession();
    return { token: null, user: null, actAs: null };
  }
  if (payload.sub != null && String(payload.sub) !== String(user.id)) {
    clearStoredSession();
    return { token: null, user: null, actAs: null };
  }
  if (
    typeof payload.mustChangePassword === "boolean"
    && user.mustChangePassword !== payload.mustChangePassword
  ) {
    user = { ...user, mustChangePassword: payload.mustChangePassword };
    writeStoredUser(user);
  }
  if (actAs && payload.role !== "admin") {
    localStorage.removeItem(ACT_AS_KEY);
    actAs = null;
  }
  return { token, user, actAs };
}

export function writeStoredUser(user: unknown) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ACT_AS_KEY);
}
