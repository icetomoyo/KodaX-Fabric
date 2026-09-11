import { departmentSubtreeIds } from "./org-employees.ts";

export type OrgFilterDepartment = {
  id: number;
  name: string;
  parentId?: number | null;
  enterpriseId: number;
  isDefault?: boolean;
};

export type OrgFilterEnterprise = {
  id: number;
  name: string;
};

export type OrgCascaderOption = {
  value: string;
  label: string;
  children?: OrgCascaderOption[];
};

export type OrgFilterSelection =
  | { kind: "enterprise"; enterpriseId: number }
  | { kind: "department"; enterpriseId: number; departmentId: number };

export function enterpriseCascaderValue(enterpriseId: number): string {
  return `ent:${enterpriseId}`;
}

export function departmentCascaderValue(departmentId: number): string {
  return `dept:${departmentId}`;
}

export function parseOrgFilterPath(path: readonly string[] | null | undefined): OrgFilterSelection | null {
  if (!path?.length) return null;
  const enterpriseToken = path[0];
  if (!enterpriseToken?.startsWith("ent:")) return null;
  const enterpriseId = Number(enterpriseToken.slice(4));
  if (!Number.isSafeInteger(enterpriseId) || enterpriseId <= 0) return null;
  const last = path[path.length - 1];
  if (last?.startsWith("dept:")) {
    const departmentId = Number(last.slice(5));
    if (!Number.isSafeInteger(departmentId) || departmentId <= 0) return null;
    return { kind: "department", enterpriseId, departmentId };
  }
  return { kind: "enterprise", enterpriseId };
}

export function orgFilterPathOf(
  selection: OrgFilterSelection,
  departments: readonly OrgFilterDepartment[],
): string[] {
  const enterprise = enterpriseCascaderValue(selection.enterpriseId);
  if (selection.kind === "enterprise") return [enterprise];
  const byId = new Map(departments.map((row) => [row.id, row]));
  const chain: string[] = [];
  const seen = new Set<number>();
  let current = byId.get(selection.departmentId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(departmentCascaderValue(current.id));
    current = current.parentId != null ? byId.get(current.parentId) : undefined;
  }
  return [enterprise, ...chain.reverse()];
}

export function buildOrgCascaderOptions(
  enterprises: readonly OrgFilterEnterprise[],
  departments: readonly OrgFilterDepartment[],
): OrgCascaderOption[] {
  const named = departments.filter((row) => !row.isDefault);
  const childrenOf = new Map<string, OrgFilterDepartment[]>();
  for (const department of named) {
    const key = department.parentId == null
      ? `ent:${department.enterpriseId}`
      : `dept:${department.parentId}`;
    const list = childrenOf.get(key) ?? [];
    list.push(department);
    childrenOf.set(key, list);
  }
  const byName = (left: { name: string }, right: { name: string }) =>
    left.name.localeCompare(right.name, "zh-CN");

  function departmentOptions(parentKey: string): OrgCascaderOption[] {
    const rows = [...(childrenOf.get(parentKey) ?? [])].sort(byName);
    return rows.map((department) => {
      const nested = departmentOptions(departmentCascaderValue(department.id));
      return {
        value: departmentCascaderValue(department.id),
        label: department.name,
        ...(nested.length ? { children: nested } : {}),
      };
    });
  }

  return [...enterprises]
    .sort(byName)
    .map((enterprise) => {
      const children = departmentOptions(enterpriseCascaderValue(enterprise.id));
      return {
        value: enterpriseCascaderValue(enterprise.id),
        label: enterprise.name,
        ...(children.length ? { children } : {}),
      };
    });
}

export function groupingDepartmentId(
  leafDepartmentId: number | null,
  selection: OrgFilterSelection,
  departments: readonly OrgFilterDepartment[],
): number | null {
  if (leafDepartmentId == null) return null;
  const byId = new Map(departments.map((row) => [row.id, row]));
  if (selection.kind === "enterprise") {
    let current = byId.get(leafDepartmentId);
    const seen = new Set<number>();
    while (current?.parentId != null && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current?.id ?? leafDepartmentId;
  }
  if (leafDepartmentId === selection.departmentId) return selection.departmentId;
  let current = byId.get(leafDepartmentId);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentId === selection.departmentId) return current.id;
    if (current.id === selection.departmentId) return selection.departmentId;
    if (current.parentId == null) break;
    current = byId.get(current.parentId);
  }
  return null;
}

export function employeeInOrgSelection(
  employee: { enterpriseId: number | null; departmentId: number | null },
  selection: OrgFilterSelection,
  subtreeIds: ReadonlySet<number>,
): boolean {
  if (employee.enterpriseId !== selection.enterpriseId) return false;
  if (selection.kind === "enterprise") return true;
  return employee.departmentId != null && subtreeIds.has(employee.departmentId);
}

export function subtreeIdsForSelection(
  selection: OrgFilterSelection,
  departments: readonly OrgFilterDepartment[],
): Set<number> {
  if (selection.kind === "enterprise") {
    return new Set(
      departments.filter((row) => row.enterpriseId === selection.enterpriseId).map((row) => row.id),
    );
  }
  return new Set(departmentSubtreeIds(selection.departmentId, departments));
}
