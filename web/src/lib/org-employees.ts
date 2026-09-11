export type OrgEmployeeScope = "enterprise" | "department";

export type OrgDepartmentNode = {
  id: number;
  parentId?: number | null;
  name?: string;
  isDefault?: boolean;
};

export type OrgTeamNode = {
  id: number;
  departmentId: number;
  name?: string;
  departmentName?: string;
  isDefault?: boolean;
};

export function departmentSubtreeIds(
  rootId: number,
  departments: readonly OrgDepartmentNode[],
): number[] {
  const children = new Map<number, number[]>();
  for (const department of departments) {
    if (department.parentId == null) continue;
    const list = children.get(department.parentId) ?? [];
    list.push(department.id);
    children.set(department.parentId, list);
  }
  const ids = [rootId];
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    ids.push(id);
    const nested = children.get(id);
    if (nested?.length) stack.push(...nested);
  }
  return ids;
}

function employeeTeamIds(row: { teamId: number | null; teamIds?: number[] }): number[] {
  if (row.teamIds?.length) return row.teamIds;
  return row.teamId != null ? [row.teamId] : [];
}

export function visibleOrgEmployees<T extends { teamId: number | null; teamIds?: number[] }>(input: {
  isTeamAdmin: boolean;
  selectedKind: OrgEmployeeScope;
  selectedDepartmentId: number | null;
  employees: readonly T[];
  teams: readonly OrgTeamNode[];
  departments: readonly OrgDepartmentNode[];
}): T[] {
  if (input.isTeamAdmin) return [...input.employees];
  if (input.selectedKind === "department" && input.selectedDepartmentId != null) {
    const subtree = new Set(departmentSubtreeIds(input.selectedDepartmentId, input.departments));
    const teamIds = new Set(
      input.teams.filter((team) => subtree.has(team.departmentId)).map((team) => team.id),
    );
    return input.employees.filter((row) => employeeTeamIds(row).some((id) => teamIds.has(id)));
  }
  return [...input.employees];
}

export function departmentPathNames(
  departmentId: number,
  departments: readonly OrgDepartmentNode[],
): string[] {
  const byId = new Map(departments.map((department) => [department.id, department]));
  const names: string[] = [];
  const seen = new Set<number>();
  let current = byId.get(departmentId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (!current.isDefault) {
      const name = current.name?.trim();
      if (name) names.push(name);
    }
    current = current.parentId != null ? byId.get(current.parentId) : undefined;
  }
  return names.reverse();
}

export function departmentPathLabel(input: {
  departmentId: number;
  departments: readonly OrgDepartmentNode[];
  enterpriseName?: string | null;
}): string {
  const parts = departmentPathNames(input.departmentId, input.departments);
  const enterprise = input.enterpriseName?.trim();
  if (enterprise) parts.unshift(enterprise);
  return parts.join("/");
}

export function employeeDepartmentLabel(input: {
  teamId: number | null;
  teamIds?: number[];
  fallbackName?: string | null;
  teams: readonly OrgTeamNode[];
  departments: readonly OrgDepartmentNode[];
}): string | null {
  const ids = employeeTeamIds(input);
  if (ids.length === 0) {
    const fallback = input.fallbackName ?? null;
    if (!fallback || fallback === "默认团队") return null;
    return fallback;
  }
  const names = ids
    .map((teamId) =>
      employeeSingleDepartmentLabel({
        teamId,
        teams: input.teams,
        departments: input.departments,
      }),
    )
    .filter((name): name is string => Boolean(name));
  if (names.length > 0) return [...new Set(names)].join("、");
  const fallback = input.fallbackName ?? null;
  if (!fallback || fallback === "默认团队") return null;
  return fallback;
}

function employeeSingleDepartmentLabel(input: {
  teamId: number;
  teams: readonly OrgTeamNode[];
  departments: readonly OrgDepartmentNode[];
}): string | null {
  const team = input.teams.find((item) => item.id === input.teamId);
  const department = team
    ? input.departments.find((item) => item.id === team.departmentId)
    : undefined;
  if (department) return department.isDefault ? null : (department.name ?? null);
  if (team?.departmentName && team.departmentName !== "默认部门") return team.departmentName;
  if (!team?.name || team.name === "默认团队") return null;
  return team.name;
}
