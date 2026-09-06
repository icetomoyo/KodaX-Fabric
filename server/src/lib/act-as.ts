import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { departments, enterprises, teams } from "../db/schema/index.js";
import type { ActAsRole, SessionActAs } from "./jwt.js";

export type ActAsRequest = {
  role: ActAsRole;
  enterpriseId: number;
  departmentId?: number;
  teamId?: number;
};

export type ResolvedActAs = {
  role: ActAsRole;
  enterpriseId: number;
  departmentIds?: number[];
  teamIds?: number[];
  actAs: SessionActAs;
};

const actAsSchema = z.object({
  role: z.enum(["org_admin", "dept_admin", "team_admin"]),
  enterpriseId: z.number().int().positive(),
  departmentId: z.number().int().positive().optional(),
  teamId: z.number().int().positive().optional(),
});

export function parseActAsHeader(raw: unknown): ActAsRequest | { invalid: true } | null {
  if (raw == null || raw === "") return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !value.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { invalid: true };
  }
  const result = actAsSchema.safeParse(parsed);
  if (!result.success) return { invalid: true };
  if (result.data.role === "dept_admin" && result.data.departmentId == null) return { invalid: true };
  if (result.data.role === "team_admin" && result.data.teamId == null) return { invalid: true };
  return result.data;
}

export async function resolveActAs(input: ActAsRequest): Promise<ResolvedActAs | null> {
  const [enterprise] = await db
    .select({
      id: enterprises.id,
      name: enterprises.name,
      status: enterprises.status,
    })
    .from(enterprises)
    .where(eq(enterprises.id, input.enterpriseId))
    .limit(1);
  if (!enterprise || enterprise.status !== "active") return null;

  if (input.role === "org_admin") {
    return {
      role: "org_admin",
      enterpriseId: enterprise.id,
      actAs: {
        role: "org_admin",
        enterpriseId: enterprise.id,
        label: enterprise.name,
      },
    };
  }

  if (input.role === "dept_admin") {
    if (input.departmentId == null) return null;
    const [department] = await db
      .select({
        id: departments.id,
        name: departments.name,
        enterpriseId: departments.enterpriseId,
        status: departments.status,
      })
      .from(departments)
      .where(eq(departments.id, input.departmentId))
      .limit(1);
    if (
      !department
      || department.status !== "active"
      || department.enterpriseId !== enterprise.id
    ) {
      return null;
    }
    return {
      role: "dept_admin",
      enterpriseId: enterprise.id,
      departmentIds: [department.id],
      actAs: {
        role: "dept_admin",
        enterpriseId: enterprise.id,
        departmentId: department.id,
        label: `${enterprise.name} · ${department.name}`,
      },
    };
  }

  if (input.teamId == null) return null;
  const [team] = await db
    .select({
      id: teams.id,
      name: teams.name,
      enterpriseId: teams.enterpriseId,
      departmentId: teams.departmentId,
      status: teams.status,
      isDefault: teams.isDefault,
      departmentName: departments.name,
    })
    .from(teams)
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(eq(teams.id, input.teamId))
    .limit(1);
  if (!team || team.status !== "active" || team.enterpriseId !== enterprise.id) return null;
  return {
    role: "team_admin",
    enterpriseId: enterprise.id,
    departmentIds: [team.departmentId],
    teamIds: [team.id],
    actAs: {
      role: "team_admin",
      enterpriseId: enterprise.id,
      departmentId: team.departmentId,
      teamId: team.id,
      label: team.isDefault
        ? `${enterprise.name} · ${team.departmentName}`
        : `${enterprise.name} · ${team.departmentName} · ${team.name}`,
    },
  };
}

export async function loadActAsOrgTree() {
  const enterpriseRows = await db
    .select({
      id: enterprises.id,
      name: enterprises.name,
      code: enterprises.code,
      status: enterprises.status,
    })
    .from(enterprises)
    .where(eq(enterprises.status, "active"))
    .orderBy(asc(enterprises.name), asc(enterprises.id));
  const enterpriseIds = enterpriseRows.map((row) => row.id);
  if (enterpriseIds.length === 0) return [];

  const departmentRows = await db
    .select({
      id: departments.id,
      name: departments.name,
      enterpriseId: departments.enterpriseId,
      isDefault: departments.isDefault,
    })
    .from(departments)
    .where(and(
      inArray(departments.enterpriseId, enterpriseIds),
      eq(departments.status, "active"),
    ))
    .orderBy(asc(departments.name), asc(departments.id));
  const departmentIds = departmentRows.map((row) => row.id);
  const teamRows = departmentIds.length
    ? await db
      .select({
        id: teams.id,
        name: teams.name,
        departmentId: teams.departmentId,
        isDefault: teams.isDefault,
      })
      .from(teams)
      .where(and(
        inArray(teams.departmentId, departmentIds),
        eq(teams.status, "active"),
      ))
      .orderBy(asc(teams.name), asc(teams.id))
    : [];

  const teamsByDepartment = new Map<number, typeof teamRows>();
  for (const team of teamRows) {
    const list = teamsByDepartment.get(team.departmentId) ?? [];
    list.push(team);
    teamsByDepartment.set(team.departmentId, list);
  }
  const departmentsByEnterprise = new Map<number, typeof departmentRows>();
  for (const department of departmentRows) {
    const list = departmentsByEnterprise.get(department.enterpriseId) ?? [];
    list.push(department);
    departmentsByEnterprise.set(department.enterpriseId, list);
  }

  return enterpriseRows.map((enterprise) => ({
    id: enterprise.id,
    name: enterprise.name,
    code: enterprise.code,
    departments: (departmentsByEnterprise.get(enterprise.id) ?? []).map((department) => ({
      id: department.id,
      name: department.name,
      isDefault: department.isDefault,
      teams: (teamsByDepartment.get(department.id) ?? [])
        .filter((team) => !team.isDefault)
        .map((team) => ({
          id: team.id,
          name: team.name,
        })),
    })),
  }));
}
