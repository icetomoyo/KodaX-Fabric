export type OrgEmployeeScope = "enterprise" | "department";

export type OrgDepartmentNode = {
  id: number;
  parentId?: number | null;
  name?: string;
  isDefault?: boolean;
  dingtalkDeptId?: number | null;
};

export type EmployeeDepartmentPath = {
  departmentId: number;
  path: string;
  isLeader: boolean;
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
  separator?: string;
}): string {
  const parts = departmentPathNames(input.departmentId, input.departments);
  const enterprise = input.enterpriseName?.trim();
  if (enterprise) parts.unshift(enterprise);
  return parts.join(input.separator ?? "/");
}

export function employeeDepartmentPaths(input: {
  departmentIds?: readonly number[] | null;
  dingtalkDeptIds?: readonly number[] | null;
  leaderInDept?: readonly { deptId: number; leader: boolean }[] | null;
  departments: readonly OrgDepartmentNode[];
  enterpriseName?: string | null;
  separator?: string;
}): EmployeeDepartmentPath[] {
  const byId = new Map(input.departments.map((department) => [department.id, department]));
  const byDingId = new Map<number, number>();
  for (const department of input.departments) {
    if (department.dingtalkDeptId != null) byDingId.set(department.dingtalkDeptId, department.id);
  }
  const ids: number[] = [];
  const push = (id: number) => {
    const department = byId.get(id);
    if (!department || department.isDefault) return;
    if (!ids.includes(id)) ids.push(id);
  };
  for (const id of input.departmentIds ?? []) push(id);
  for (const dingId of input.dingtalkDeptIds ?? []) {
    const id = byDingId.get(dingId);
    if (id != null) push(id);
  }
  const leaderDingIds = new Set(
    (input.leaderInDept ?? []).filter((item) => item.leader).map((item) => item.deptId),
  );
  const separator = input.separator ?? "-";
  return ids.flatMap((departmentId) => {
    const path = departmentPathLabel({
      departmentId,
      departments: input.departments,
      enterpriseName: input.enterpriseName,
      separator,
    });
    if (!path) return [];
    const dingId = byId.get(departmentId)?.dingtalkDeptId ?? null;
    return [{
      departmentId,
      path,
      isLeader: dingId != null && leaderDingIds.has(dingId),
    }];
  });
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
