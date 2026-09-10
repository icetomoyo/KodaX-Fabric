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

export function visibleOrgEmployees<T extends { teamId: number | null }>(input: {
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
    return input.employees.filter((row) => row.teamId != null && teamIds.has(row.teamId));
  }
  return [...input.employees];
}

export function employeeDepartmentLabel(input: {
  teamId: number | null;
  fallbackName?: string | null;
  teams: readonly OrgTeamNode[];
  departments: readonly OrgDepartmentNode[];
}): string | null {
  if (input.teamId == null) return null;
  const team = input.teams.find((item) => item.id === input.teamId);
  const department = team
    ? input.departments.find((item) => item.id === team.departmentId)
    : undefined;
  if (department) return department.isDefault ? null : (department.name ?? null);
  if (team?.departmentName && team.departmentName !== "默认部门") return team.departmentName;
  const fallback = input.fallbackName ?? team?.name ?? null;
  if (!fallback || fallback === "默认团队") return null;
  return fallback;
}
