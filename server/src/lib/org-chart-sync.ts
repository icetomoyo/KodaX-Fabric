import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { departments, employeeApiKeys, employees, enterprises, teamMembers, teams } from "../db/schema/index.js";
import { ensureDefaultTeam } from "./enterprise.js";
import { departmentAndDescendantIds } from "./department-tree.js";

export type OrgChartMember = { name: string };
export type OrgChartNode = {
  deptName: string;
  members?: OrgChartMember[];
  children?: OrgChartNode[];
};
export type OrgChartFile = {
  company?: string;
  orgStructure: OrgChartNode;
};

export type ExistingEnterprise = { id: number; name: string };
export type ExistingDepartment = {
  id: number;
  enterpriseId: number;
  parentId: number | null;
  name: string;
  isDefault: boolean;
};
export type ExistingEmployee = {
  id: number;
  name: string;
  role: string;
  enterpriseId: number | null;
  departmentIds: number[];
};

export type PlannedDepartmentCreate = {
  enterpriseId: number;
  parentPath: string[];
  name: string;
  path: string[];
};

export type PlannedMembership = {
  employeeId: number;
  name: string;
  targetEnterpriseId: number;
  desiredPaths: string[][];
};

export type OrgChartSyncPlan = {
  createDepartments: PlannedDepartmentCreate[];
  renameDepartments: Array<{ id: number; from: string; to: string }>;
  enterpriseMoves: Array<{
    employeeId: number;
    fromEnterpriseId: number | null;
    toEnterpriseId: number;
  }>;
  memberships: PlannedMembership[];
  unmatchedEmployees: Array<{ id: number; name: string }>;
};

const COMPANY_ENTERPRISE_NAMES = ["海致科技", "海致星图"] as const;
const LEGAL_DEPT_ENTERPRISE = "海致集团";
const SKIP_ROLES = new Set(["admin", "org_admin"]);

export function normalizeDepartmentName(name: string): string {
  return name.replace(/[（(]科技[）)]/g, "").replace(/[（(]星图[）)]/g, "").trim();
}

export function matchSiblingDepartment(
  wanted: string,
  siblings: readonly ExistingDepartment[],
): ExistingDepartment | undefined {
  const named = siblings.filter((row) => !row.isDefault);
  const exact = named.find((row) => row.name === wanted);
  if (exact) return exact;
  const normalized = named.filter(
    (row) => normalizeDepartmentName(row.name) === normalizeDepartmentName(wanted),
  );
  if (normalized.length === 1) return normalized[0];
  const groupVariant = named.filter(
    (row) => row.name === `${wanted}组` || wanted === `${row.name}组`,
  );
  if (groupVariant.length === 1) return groupVariant[0];
  return undefined;
}

type ChartPlacement = {
  enterpriseName: string;
  path: string[];
};

function collectNamePlacements(chart: OrgChartNode): Map<string, ChartPlacement[]> {
  const byName = new Map<string, ChartPlacement[]>();
  const add = (name: string, placement: ChartPlacement) => {
    const list = byName.get(name) ?? [];
    if (
      !list.some(
        (row) =>
          row.enterpriseName === placement.enterpriseName && row.path.join("/") === placement.path.join("/"),
      )
    ) {
      list.push(placement);
    }
    byName.set(name, list);
  };

  const visit = (node: OrgChartNode, enterpriseName: string, path: string[]) => {
    for (const member of node.members ?? []) {
      const trimmed = member.name.trim();
      if (trimmed && path.length > 0) add(trimmed, { enterpriseName, path });
    }
    for (const child of node.children ?? []) {
      visit(child, enterpriseName, [...path, child.deptName]);
    }
  };

  for (const child of chart.children ?? []) {
    if (COMPANY_ENTERPRISE_NAMES.includes(child.deptName as (typeof COMPANY_ENTERPRISE_NAMES)[number])) {
      visit(child, child.deptName, []);
    } else if (child.deptName === "法务顾问") {
      visit(child, LEGAL_DEPT_ENTERPRISE, ["法务顾问"]);
    }
  }
  return byName;
}

type DeptIndex = {
  byParent: Map<string, ExistingDepartment[]>;
  byId: Map<number, ExistingDepartment>;
};

function departmentIndex(departments: readonly ExistingDepartment[]): DeptIndex {
  const byParent = new Map<string, ExistingDepartment[]>();
  const byId = new Map<number, ExistingDepartment>();
  for (const row of departments) {
    byId.set(row.id, row);
    const key = `${row.enterpriseId}:${row.parentId ?? 0}`;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }
  return { byParent, byId };
}

function childrenOf(index: DeptIndex, enterpriseId: number, parentId: number | null): ExistingDepartment[] {
  return index.byParent.get(`${enterpriseId}:${parentId ?? 0}`) ?? [];
}

export function planOrgChartSync(input: {
  chart: OrgChartFile | OrgChartNode;
  enterprises: readonly ExistingEnterprise[];
  departments: readonly ExistingDepartment[];
  employees: readonly ExistingEmployee[];
}): OrgChartSyncPlan {
  const root = "orgStructure" in input.chart ? input.chart.orgStructure : input.chart;
  const enterprisesByName = new Map(input.enterprises.map((row) => [row.name, row]));
  const index = departmentIndex(input.departments);
  const placements = collectNamePlacements(root);

  const createDepartments: PlannedDepartmentCreate[] = [];
  const renameDepartments: Array<{ id: number; from: string; to: string }> = [];
  const seenCreates = new Set<string>();

  const ensurePath = (enterpriseId: number, path: string[]) => {
    let parentId: number | null = null;
    for (let i = 0; i < path.length; i += 1) {
      const name = path[i]!;
      const siblings = childrenOf(index, enterpriseId, parentId);
      const match = matchSiblingDepartment(name, siblings);
      if (match) {
        if (match.name !== name) {
          if (!renameDepartments.some((row) => row.id === match.id)) {
            renameDepartments.push({ id: match.id, from: match.name, to: name });
          }
          match.name = name;
        }
        parentId = match.id;
        continue;
      }
      const key = `${enterpriseId}:${(parentId ?? 0)}:${path.slice(0, i + 1).join("/")}`;
      if (!seenCreates.has(key)) {
        seenCreates.add(key);
        createDepartments.push({
          enterpriseId,
          parentPath: path.slice(0, i),
          name,
          path: path.slice(0, i + 1),
        });
      }
      // Pretend it exists for subsequent siblings in this walk by inserting a placeholder.
      const placeholder: ExistingDepartment = {
        id: -1 * (seenCreates.size + 1000),
        enterpriseId,
        parentId,
        name,
        isDefault: false,
      };
      const list = index.byParent.get(`${enterpriseId}:${parentId ?? 0}`) ?? [];
      list.push(placeholder);
      index.byParent.set(`${enterpriseId}:${parentId ?? 0}`, list);
      index.byId.set(placeholder.id, placeholder);
      parentId = placeholder.id;
    }
  };

  const visitTree = (node: OrgChartNode, enterpriseId: number, path: string[]) => {
    if (path.length > 0) ensurePath(enterpriseId, path);
    for (const child of node.children ?? []) {
      visitTree(child, enterpriseId, [...path, child.deptName]);
    }
  };

  for (const child of root.children ?? []) {
    if (COMPANY_ENTERPRISE_NAMES.includes(child.deptName as (typeof COMPANY_ENTERPRISE_NAMES)[number])) {
      const enterprise = enterprisesByName.get(child.deptName);
      if (!enterprise) continue;
      visitTree(child, enterprise.id, []);
    } else if (child.deptName === "法务顾问") {
      const enterprise = enterprisesByName.get(LEGAL_DEPT_ENTERPRISE);
      if (!enterprise) continue;
      visitTree(child, enterprise.id, ["法务顾问"]);
    }
  }

  const enterpriseMoves: OrgChartSyncPlan["enterpriseMoves"] = [];
  const memberships: PlannedMembership[] = [];
  const unmatchedEmployees: OrgChartSyncPlan["unmatchedEmployees"] = [];

  for (const employee of input.employees) {
    if (SKIP_ROLES.has(employee.role)) continue;
    const hits = placements.get(employee.name) ?? [];
    if (hits.length === 0) {
      unmatchedEmployees.push({ id: employee.id, name: employee.name });
      continue;
    }
    const companyNames = [...new Set(hits.map((row) => row.enterpriseName))];
    const currentName = input.enterprises.find((row) => row.id === employee.enterpriseId)?.name;
    const targetName = currentName && companyNames.includes(currentName)
      ? currentName
      : companyNames.includes("海致科技")
        ? "海致科技"
        : companyNames[0]!;
    const targetEnterprise = enterprisesByName.get(targetName);
    if (!targetEnterprise) continue;
    if (employee.enterpriseId !== targetEnterprise.id) {
      enterpriseMoves.push({
        employeeId: employee.id,
        fromEnterpriseId: employee.enterpriseId,
        toEnterpriseId: targetEnterprise.id,
      });
    }
    const desiredPaths = hits
      .filter((row) => row.enterpriseName === targetName)
      .map((row) => row.path)
      .filter((path) => path.length > 0);
    const uniquePaths = [...new Map(desiredPaths.map((path) => [path.join("/"), path])).values()];
    if (uniquePaths.length === 0) continue;
    memberships.push({
      employeeId: employee.id,
      name: employee.name,
      targetEnterpriseId: targetEnterprise.id,
      desiredPaths: uniquePaths,
    });
  }

  return {
    createDepartments,
    renameDepartments,
    enterpriseMoves,
    memberships,
    unmatchedEmployees,
  };
}

export function pickApiKeyRetargetDepartment(input: {
  removedDepartmentId: number;
  desiredDepartmentIds: readonly number[];
  departments: readonly { id: number; parentId: number | null }[];
}): number | null {
  if (input.desiredDepartmentIds.length === 0) return null;
  const descendants = new Set(departmentAndDescendantIds(input.removedDepartmentId, input.departments));
  const nested = input.desiredDepartmentIds.filter((id) => descendants.has(id) && id !== input.removedDepartmentId);
  if (nested.length === 1) return nested[0]!;
  if (input.desiredDepartmentIds.length === 1) return input.desiredDepartmentIds[0]!;
  return nested[0] ?? input.desiredDepartmentIds[0] ?? null;
}

function pathKey(enterpriseId: number, path: string[]): string {
  return `${enterpriseId}:${path.join("/")}`;
}

export async function applyOrgChartSync(plan: OrgChartSyncPlan): Promise<{
  createdDepartments: number;
  renamedDepartments: number;
  movedEmployees: number;
  membershipChanges: number;
  retargetedKeys: number;
}> {
  const pathToId = new Map<string, number>();
  const allDepartments = await db
    .select({
      id: departments.id,
      enterpriseId: departments.enterpriseId,
      parentId: departments.parentId,
      name: departments.name,
      isDefault: departments.isDefault,
    })
    .from(departments);

  const fillPaths = (rows: typeof allDepartments) => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const row of rows) {
      if (row.isDefault) continue;
      const names: string[] = [];
      const seen = new Set<number>();
      let current: (typeof row) | undefined = row;
      while (current && !current.isDefault && !seen.has(current.id)) {
        seen.add(current.id);
        names.push(current.name);
        current = current.parentId != null ? byId.get(current.parentId) : undefined;
      }
      names.reverse();
      if (names.length) pathToId.set(pathKey(row.enterpriseId, names), row.id);
    }
  };
  fillPaths(allDepartments);

  for (const rename of plan.renameDepartments) {
    await db
      .update(departments)
      .set({ name: rename.to, updatedAt: new Date() })
      .where(eq(departments.id, rename.id));
    const row = allDepartments.find((item) => item.id === rename.id);
    if (row) row.name = rename.to;
  }
  fillPaths(allDepartments);

  let createdDepartments = 0;
  for (const item of plan.createDepartments) {
    const existingId = pathToId.get(pathKey(item.enterpriseId, item.path));
    if (existingId != null && existingId > 0) continue;
    const parentId = item.parentPath.length
      ? pathToId.get(pathKey(item.enterpriseId, item.parentPath)) ?? null
      : null;
    if (item.parentPath.length > 0 && parentId == null) {
      throw new Error(`missing parent department for ${item.path.join("/")}`);
    }
    const [row] = await db
      .insert(departments)
      .values({
        enterpriseId: item.enterpriseId,
        parentId,
        name: item.name,
        status: "active",
      })
      .returning({ id: departments.id, enterpriseId: departments.enterpriseId, parentId: departments.parentId, name: departments.name });
    await ensureDefaultTeam(row.id, item.enterpriseId);
    pathToId.set(pathKey(item.enterpriseId, item.path), row.id);
    allDepartments.push({ ...row, isDefault: false });
    createdDepartments += 1;
  }

  fillPaths(allDepartments);

  const defaultTeamByDepartment = new Map<number, number>();
  const defaultTeams = await db
    .select({ id: teams.id, departmentId: teams.departmentId })
    .from(teams)
    .where(eq(teams.isDefault, true));
  for (const row of defaultTeams) defaultTeamByDepartment.set(row.departmentId, row.id);

  let movedEmployees = 0;
  for (const move of plan.enterpriseMoves) {
    await db
      .update(employees)
      .set({ enterpriseId: move.toEnterpriseId, updatedAt: new Date() })
      .where(eq(employees.id, move.employeeId));
    movedEmployees += 1;
  }

  const tree = allDepartments.map((row) => ({ id: row.id, parentId: row.parentId }));
  let membershipChanges = 0;
  let retargetedKeys = 0;

  for (const item of plan.memberships) {
    const desiredIds = [...new Set(
      item.desiredPaths
        .map((path) => pathToId.get(pathKey(item.targetEnterpriseId, path)))
        .filter((id): id is number => id != null && id > 0),
    )];
    const current = await db
      .select({
        teamId: teamMembers.teamId,
        departmentId: teams.departmentId,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.employeeId, item.employeeId));
    const currentDeptIds = new Set(current.map((row) => row.departmentId));
    const desiredSet = new Set(desiredIds);
    const toAdd = desiredIds.filter((id) => !currentDeptIds.has(id));
    const toRemove = current.filter((row) => !desiredSet.has(row.departmentId));

    if (toRemove.length > 0) {
      const keys = await db
        .select({
          id: employeeApiKeys.id,
          teamId: employeeApiKeys.teamId,
          departmentId: teams.departmentId,
        })
        .from(employeeApiKeys)
        .innerJoin(teams, eq(employeeApiKeys.teamId, teams.id))
        .where(
          and(
            eq(employeeApiKeys.employeeId, item.employeeId),
            inArray(employeeApiKeys.teamId, toRemove.map((row) => row.teamId)),
          ),
        );
      for (const key of keys) {
        const nextDepartmentId = pickApiKeyRetargetDepartment({
          removedDepartmentId: key.departmentId,
          desiredDepartmentIds: desiredIds,
          departments: tree,
        });
        const nextTeamId = nextDepartmentId != null ? defaultTeamByDepartment.get(nextDepartmentId) : null;
        if (nextTeamId != null && nextTeamId !== key.teamId) {
          await db
            .update(employeeApiKeys)
            .set({ teamId: nextTeamId })
            .where(eq(employeeApiKeys.id, key.id));
          retargetedKeys += 1;
        }
      }
      await db.delete(teamMembers).where(
        and(
          eq(teamMembers.employeeId, item.employeeId),
          inArray(teamMembers.teamId, toRemove.map((row) => row.teamId)),
        ),
      );
      membershipChanges += toRemove.length;
    }

    for (const departmentId of toAdd) {
      const teamId = defaultTeamByDepartment.get(departmentId);
      if (teamId == null) continue;
      await db.insert(teamMembers).values({
        teamId,
        employeeId: item.employeeId,
        role: "member",
      }).onConflictDoNothing({ target: [teamMembers.teamId, teamMembers.employeeId] });
      membershipChanges += 1;
    }
  }

  return {
    createdDepartments,
    renamedDepartments: plan.renameDepartments.length,
    movedEmployees,
    membershipChanges,
    retargetedKeys,
  };
}
