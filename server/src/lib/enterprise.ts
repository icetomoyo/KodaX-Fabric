import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { enterprises } from "../db/schema/index.js";
import type { SessionRole } from "./jwt.js";

export const DEFAULT_ENTERPRISE_NAME = "海致集团";
export const ENTERPRISE_CODE_PATTERN = /^E[A-HJ-NP-Z2-9]{8}$/;
const ENTERPRISE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const SUPER_ADMIN_ROLE = "admin" as const;
export const ORG_ADMIN_ROLE = "org_admin" as const;

export type EnterpriseActor = {
  role: SessionRole;
  enterpriseId: number | null;
};

export type EmployeeMembership = {
  role: SessionRole;
  enterpriseId: number | null;
};

export type UserListScope =
  | { enterpriseId?: number; excludeRoles?: SessionRole[] }
  | { forbidden: true };

export function isSuperAdmin(role: SessionRole): boolean {
  return role === SUPER_ADMIN_ROLE;
}

export function isOrgAdmin(role: SessionRole): boolean {
  return role === ORG_ADMIN_ROLE;
}

export function canUseAdminConsole(role: SessionRole): boolean {
  return role === SUPER_ADMIN_ROLE || role === ORG_ADMIN_ROLE || role === "team_admin";
}

export function generateEnterpriseCode(randomDigit = randomInt): string {
  let suffix = "";
  for (let i = 0; i < 8; i += 1) {
    suffix += ENTERPRISE_CODE_ALPHABET[randomDigit(ENTERPRISE_CODE_ALPHABET.length)];
  }
  return `E${suffix}`;
}

export function normalizeEnterpriseCode(value: string): string {
  return value.trim().toUpperCase();
}

export function resolveUserListScope(
  actor: EnterpriseActor,
  requestedEnterpriseId?: number,
): UserListScope {
  if (actor.role === SUPER_ADMIN_ROLE) {
    return {
      enterpriseId: requestedEnterpriseId,
      excludeRoles: [SUPER_ADMIN_ROLE],
    };
  }
  if (actor.role !== ORG_ADMIN_ROLE) {
    return { forbidden: true };
  }
  if (actor.enterpriseId == null) return { forbidden: true };
  if (requestedEnterpriseId != null && requestedEnterpriseId !== actor.enterpriseId) {
    return { forbidden: true };
  }
  return { enterpriseId: actor.enterpriseId, excludeRoles: [SUPER_ADMIN_ROLE, ORG_ADMIN_ROLE] };
}

export function canAccessEmployee(actor: EnterpriseActor, target: EmployeeMembership): boolean {
  if (target.role === SUPER_ADMIN_ROLE) return false;
  if (actor.role === SUPER_ADMIN_ROLE) return true;
  if (actor.role !== ORG_ADMIN_ROLE) return false;
  return target.enterpriseId === actor.enterpriseId;
}

export function resolveCreatedUserFields(
  actor: EnterpriseActor,
  input: { role?: SessionRole; enterpriseId?: number | null },
): { role: SessionRole; enterpriseId: number } | { error: string; status: 403 } {
  if (actor.role === ORG_ADMIN_ROLE) {
    if (actor.enterpriseId == null) {
      return { error: "权限不足", status: 403 };
    }
    if (input.role && input.role !== "employee") {
      return { error: "权限不足", status: 403 };
    }
    if (input.enterpriseId != null && input.enterpriseId !== actor.enterpriseId) {
      return { error: "权限不足", status: 403 };
    }
    return { role: "employee", enterpriseId: actor.enterpriseId };
  }
  return { error: "权限不足", status: 403 };
}

const ORG_ADMIN_ASSIGNABLE_ROLES: SessionRole[] = ["employee", "team_admin"];

const SUPER_ADMIN_ASSIGNABLE_ROLES: SessionRole[] = ["employee", "team_admin", "org_admin"];

export function resolveUpdatedUserFields(
  actor: EnterpriseActor,
  target: EmployeeMembership,
  input: { role?: SessionRole; enterpriseId?: number | null },
): { role: SessionRole; enterpriseId: number | null } | { error: string; status: 403 } {
  if (!canAccessEmployee(actor, target)) {
    return { error: "权限不足", status: 403 };
  }
  if (actor.role === SUPER_ADMIN_ROLE) {
    const enterpriseId = input.enterpriseId === undefined ? target.enterpriseId : input.enterpriseId;
    if (input.role == null || input.role === target.role) {
      return { role: target.role, enterpriseId };
    }
    if (!SUPER_ADMIN_ASSIGNABLE_ROLES.includes(input.role)) {
      return { error: "权限不足", status: 403 };
    }
    return { role: input.role, enterpriseId };
  }
  if (actor.role !== ORG_ADMIN_ROLE || actor.enterpriseId == null) {
    return { error: "权限不足", status: 403 };
  }
  if (input.enterpriseId != null && input.enterpriseId !== actor.enterpriseId) {
    return { error: "权限不足", status: 403 };
  }
  if (input.role == null || input.role === target.role) {
    return { role: target.role, enterpriseId: actor.enterpriseId };
  }
  if (!ORG_ADMIN_ASSIGNABLE_ROLES.includes(input.role)) {
    return { error: "权限不足", status: 403 };
  }
  return { role: input.role, enterpriseId: actor.enterpriseId };
}

export async function insertEnterprise(input: {
  name: string;
  status?: "pending" | "active" | "disabled";
}) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const [row] = await db
        .insert(enterprises)
        .values({
          name: input.name,
          code: generateEnterpriseCode(),
          status: input.status ?? "active",
        })
        .returning({
          id: enterprises.id,
          name: enterprises.name,
          code: enterprises.code,
          status: enterprises.status,
          createdAt: enterprises.createdAt,
          updatedAt: enterprises.updatedAt,
        });
      return row;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("enterprises_code_uidx") && attempt < 7) continue;
      throw error;
    }
  }
  throw new Error("failed to allocate enterprise code");
}

export async function getDefaultEnterpriseId(): Promise<number> {
  const [named] = await db
    .select({ id: enterprises.id })
    .from(enterprises)
    .where(eq(enterprises.name, DEFAULT_ENTERPRISE_NAME))
    .limit(1);
  if (named) return named.id;

  const [legacy] = await db
    .select({ id: enterprises.id })
    .from(enterprises)
    .where(eq(enterprises.name, "默认企业"))
    .limit(1);
  if (legacy) return legacy.id;

  try {
    const created = await insertEnterprise({ name: DEFAULT_ENTERPRISE_NAME, status: "active" });
    return created.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("enterprises_name_uidx") && !message.includes("unique")) throw error;
  }

  const [anyRow] = await db.select({ id: enterprises.id }).from(enterprises).limit(1);
  if (!anyRow) {
    throw new Error("default enterprise is missing");
  }
  return anyRow.id;
}
