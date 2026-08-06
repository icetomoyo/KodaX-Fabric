import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { employees, logAccessGrants } from "../db/schema/index.js";

export type AccessSubject = {
  employeeId: number;
  role: "employee" | "admin" | "auditor";
};

/** Admin always allowed. Auditor/others via active grants. */
export async function canAccessEmployeeLogs(
  subject: AccessSubject,
  targetEmployeeId: number,
): Promise<{ allowed: boolean }> {
  if (subject.role === "admin") {
    return { allowed: true };
  }

  if (subject.employeeId === targetEmployeeId) {
    return { allowed: true };
  }

  const grants = await db
    .select()
    .from(logAccessGrants)
    .where(
      and(
        eq(logAccessGrants.granteeEmployeeId, subject.employeeId),
        eq(logAccessGrants.status, "active"),
        or(sql`${logAccessGrants.expiresAt} is null`, sql`${logAccessGrants.expiresAt} > now()`),
      ),
    );

  if (grants.length === 0) {
    return { allowed: false };
  }

  const [target] = await db
    .select({ id: employees.id, dept: employees.dept })
    .from(employees)
    .where(eq(employees.id, targetEmployeeId))
    .limit(1);

  if (!target) {
    return { allowed: false };
  }

  let allowed = false;

  for (const g of grants) {
    const payload = (g.scopePayload ?? {}) as {
      employeeIds?: number[];
      depts?: string[];
    };

    let hit = false;
    if (g.scopeType === "all") hit = true;
    if (g.scopeType === "dept" && target.dept && payload.depts?.includes(target.dept)) hit = true;
    if (g.scopeType === "employees" && payload.employeeIds?.includes(targetEmployeeId)) hit = true;

    if (hit) {
      allowed = true;
    }
  }

  return { allowed };
}

export async function listAccessibleEmployeeFilter(
  subject: AccessSubject,
): Promise<{ all: true } | { all: false; employeeIds: number[] | null; depts: string[] }> {
  if (subject.role === "admin") {
    return { all: true };
  }

  const grants = await db
    .select()
    .from(logAccessGrants)
    .where(
      and(
        eq(logAccessGrants.granteeEmployeeId, subject.employeeId),
        eq(logAccessGrants.status, "active"),
        or(sql`${logAccessGrants.expiresAt} is null`, sql`${logAccessGrants.expiresAt} > now()`),
      ),
    );

  if (grants.some((g) => g.scopeType === "all")) {
    return { all: true };
  }

  const employeeIds = new Set<number>();
  const depts = new Set<string>();

  for (const g of grants) {
    const payload = (g.scopePayload ?? {}) as {
      employeeIds?: number[];
      depts?: string[];
    };
    if (g.scopeType === "employees") {
      for (const id of payload.employeeIds ?? []) employeeIds.add(id);
    }
    if (g.scopeType === "dept") {
      for (const d of payload.depts ?? []) depts.add(d);
    }
  }

  if (employeeIds.size === 0 && depts.size === 0) {
    return { all: false, employeeIds: [], depts: [] };
  }

  return {
    all: false,
    employeeIds: [...employeeIds],
    depts: [...depts],
  };
}
