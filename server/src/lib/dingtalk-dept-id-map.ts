import type { DingtalkDepartmentNode } from "./dingtalk-department-tree.js";

export const DINGTALK_ALIGNED_ENTERPRISES = ["海致星图", "海致科技"] as const;

const SKIPPED_DINGTALK_PATHS = new Set([
  "海致星图/残疾人安置（星图）",
  "海致科技/外包团队",
  "海致科技/残疾人安置（科技）",
]);

export type MappedDepartment = {
  id: number;
  enterpriseId: number;
  parentId: number | null;
  name: string;
  isDefault: boolean;
};

export type DingtalkDeptIdWrite = {
  departmentId: number;
  dingtalkDeptId: number;
  enterpriseName: string;
  path: string[];
};

export type DingtalkDeptIdPlan = {
  writes: DingtalkDeptIdWrite[];
  skipped: Array<{ enterpriseName: string; path: string[]; dingtalkDeptId: number }>;
  unmatchedDingtalk: Array<{ enterpriseName: string; path: string[]; dingtalkDeptId: number }>;
};

function pathKey(parts: string[]): string {
  return parts.join("/");
}

function collectLocalPaths(
  enterpriseId: number,
  departments: readonly MappedDepartment[],
): Map<string, MappedDepartment> {
  const byId = new Map(departments.filter((row) => row.enterpriseId === enterpriseId).map((row) => [row.id, row]));
  const named = [...byId.values()].filter((row) => !row.isDefault);
  const namedIds = new Set(named.map((row) => row.id));
  const byPath = new Map<string, MappedDepartment>();
  for (const row of named) {
    const chain: string[] = [];
    let current: MappedDepartment | undefined = row;
    let guard = 0;
    while (current && namedIds.has(current.id) && guard < 30) {
      chain.push(current.name);
      current = current.parentId != null ? byId.get(current.parentId) : undefined;
      guard += 1;
    }
    chain.reverse();
    if (chain.length) byPath.set(pathKey(chain), row);
  }
  return byPath;
}

export function planDingtalkDeptIdWrites(input: {
  tree: DingtalkDepartmentNode;
  enterprises: readonly { id: number; name: string }[];
  departments: readonly MappedDepartment[];
}): DingtalkDeptIdPlan {
  const enterprisesByName = new Map(input.enterprises.map((row) => [row.name, row]));
  const writes: DingtalkDeptIdWrite[] = [];
  const skipped: DingtalkDeptIdPlan["skipped"] = [];
  const unmatchedDingtalk: DingtalkDeptIdPlan["unmatchedDingtalk"] = [];
  const seenDepartments = new Set<number>();

  for (const company of input.tree.children ?? []) {
    if (!DINGTALK_ALIGNED_ENTERPRISES.includes(company.name as (typeof DINGTALK_ALIGNED_ENTERPRISES)[number])) {
      continue;
    }
    const enterprise = enterprisesByName.get(company.name);
    if (!enterprise) continue;
    const localByPath = collectLocalPaths(enterprise.id, input.departments);

    const visit = (node: DingtalkDepartmentNode, path: string[]) => {
      if (path.length > 0) {
        const full = pathKey([company.name, ...path]);
        if (SKIPPED_DINGTALK_PATHS.has(full)) {
          skipped.push({ enterpriseName: company.name, path, dingtalkDeptId: node.deptId });
        } else {
          const local = localByPath.get(pathKey(path));
          if (local && !seenDepartments.has(local.id)) {
            seenDepartments.add(local.id);
            writes.push({
              departmentId: local.id,
              dingtalkDeptId: node.deptId,
              enterpriseName: company.name,
              path,
            });
          } else if (!local) {
            unmatchedDingtalk.push({
              enterpriseName: company.name,
              path,
              dingtalkDeptId: node.deptId,
            });
          }
        }
      }
      for (const child of node.children ?? []) {
        visit(child, [...path, child.name]);
      }
    };
    visit(company, []);
  }

  return { writes, skipped, unmatchedDingtalk };
}
