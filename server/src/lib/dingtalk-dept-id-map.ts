import type { DingtalkDepartmentNode } from "./dingtalk-department-tree.js";

export const DINGTALK_ALIGNED_UNITS = [
  "海致星图",
  "海致科技",
  "外部人员组",
  "法务顾问",
  "钉钉部署",
  "分贝通测试",
] as const;
export const DINGTALK_ALIGNED_ENTERPRISES = DINGTALK_ALIGNED_UNITS;
export const DINGTALK_GROUP_ENTERPRISE_NAME = "海致集团";

const SKIPPED_DINGTALK_PATHS = new Set([
  "海致星图/残疾人安置（星图）",
  "海致科技/残疾人安置（科技）",
]);

export const SKIP_MEMBERSHIP_DING_IDS = new Set([
  1,
  990493186, // 残疾人安置（科技）
  990692143, // 残疾人安置（星图）
]);

export function resolveDingtalkAlignedEnterprise(
  enterprisesByName: ReadonlyMap<string, { id: number; name: string }>,
  unitName: string,
): { enterprise: { id: number; name: string }; pathPrefix: string[] } | null {
  const named = enterprisesByName.get(unitName);
  if (named) return { enterprise: named, pathPrefix: [] };
  const group = enterprisesByName.get(DINGTALK_GROUP_ENTERPRISE_NAME);
  if (group) return { enterprise: group, pathPrefix: [unitName] };
  return null;
}

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
    if (!DINGTALK_ALIGNED_UNITS.includes(company.name as (typeof DINGTALK_ALIGNED_UNITS)[number])) {
      continue;
    }
    const resolved = resolveDingtalkAlignedEnterprise(enterprisesByName, company.name);
    if (!resolved) continue;
    const localByPath = collectLocalPaths(resolved.enterprise.id, input.departments);

    const visit = (node: DingtalkDepartmentNode, path: string[]) => {
      if (path.length > 0) {
        const full = pathKey(path[0] === company.name ? path : [company.name, ...path]);
        if (SKIPPED_DINGTALK_PATHS.has(full)) {
          skipped.push({ enterpriseName: company.name, path, dingtalkDeptId: node.deptId });
        } else {
          const local = localByPath.get(pathKey(path));
          if (local && !seenDepartments.has(local.id)) {
            seenDepartments.add(local.id);
            writes.push({
              departmentId: local.id,
              dingtalkDeptId: node.deptId,
              enterpriseName: resolved.enterprise.name,
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
    visit(company, resolved.pathPrefix);
  }

  return { writes, skipped, unmatchedDingtalk };
}

export type DepartmentTreeRow = {
  id: number;
  parentId: number | null;
  name: string;
  isDefault: boolean;
  dingtalkDeptId: number | null;
};

export type DepartmentTreeCreate = {
  name: string;
  dingtalkDeptId: number;
  parentDingtalkDeptId: number | null;
  path: string[];
};

export type DepartmentTreeRename = {
  departmentId: number;
  dingtalkDeptId: number;
  from: string;
  to: string;
  path: string[];
};

export type DepartmentTreeMove = {
  departmentId: number;
  dingtalkDeptId: number;
  fromParentDingtalkDeptId: number | null;
  toParentDingtalkDeptId: number | null;
  path: string[];
};

export type DepartmentTreeSyncPlan = {
  creates: DepartmentTreeCreate[];
  renames: DepartmentTreeRename[];
  moves: DepartmentTreeMove[];
  skipped: Array<{ path: string[]; dingtalkDeptId: number }>;
  stale: Array<{ departmentId: number; name: string; dingtalkDeptId: number }>;
};

function parentDingtalkId(
  row: DepartmentTreeRow,
  byId: ReadonlyMap<number, DepartmentTreeRow>,
): number | null {
  if (row.parentId == null) return null;
  return byId.get(row.parentId)?.dingtalkDeptId ?? null;
}

export function planDingtalkDepartmentTreeSync(input: {
  tree: DingtalkDepartmentNode;
  departments: readonly DepartmentTreeRow[];
}): DepartmentTreeSyncPlan {
  const byId = new Map(input.departments.map((row) => [row.id, row]));
  const byDing = new Map(
    input.departments
      .filter((row) => row.dingtalkDeptId != null)
      .map((row) => [row.dingtalkDeptId as number, row]),
  );
  const creates: DepartmentTreeCreate[] = [];
  const renames: DepartmentTreeRename[] = [];
  const moves: DepartmentTreeMove[] = [];
  const skipped: DepartmentTreeSyncPlan["skipped"] = [];
  const seenDing = new Set<number>();

  for (const company of input.tree.children ?? []) {
    if (!DINGTALK_ALIGNED_UNITS.includes(company.name as (typeof DINGTALK_ALIGNED_UNITS)[number])) {
      continue;
    }
    const visit = (node: DingtalkDepartmentNode, path: string[]) => {
      const full = pathKey(path);
      if (SKIPPED_DINGTALK_PATHS.has(full)) {
        skipped.push({ path, dingtalkDeptId: node.deptId });
        for (const child of node.children ?? []) visit(child, [...path, child.name]);
        return;
      }
      seenDing.add(node.deptId);
      const expectedParentDing = node.parentId === 1 ? null : node.parentId;
      const existing = byDing.get(node.deptId);
      if (existing) {
        if (existing.name !== node.name) {
          renames.push({
            departmentId: existing.id,
            dingtalkDeptId: node.deptId,
            from: existing.name,
            to: node.name,
            path,
          });
        }
        const actualParentDing = parentDingtalkId(existing, byId);
        if (actualParentDing !== expectedParentDing) {
          moves.push({
            departmentId: existing.id,
            dingtalkDeptId: node.deptId,
            fromParentDingtalkDeptId: actualParentDing,
            toParentDingtalkDeptId: expectedParentDing,
            path,
          });
        }
      } else {
        creates.push({
          name: node.name,
          dingtalkDeptId: node.deptId,
          parentDingtalkDeptId: expectedParentDing,
          path,
        });
      }
      for (const child of node.children ?? []) visit(child, [...path, child.name]);
    };
    visit(company, [company.name]);
  }

  const stale = input.departments
    .filter(
      (row) =>
        row.dingtalkDeptId != null && !row.isDefault && !seenDing.has(row.dingtalkDeptId),
    )
    .map((row) => ({
      departmentId: row.id,
      name: row.name,
      dingtalkDeptId: row.dingtalkDeptId as number,
    }));

  return { creates, renames, moves, skipped, stale };
}

export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function departmentTreeSyncSql(plan: DepartmentTreeSyncPlan, source: string): string {
  const statements: string[] = ["BEGIN;"];
  for (const create of plan.creates) {
    if (create.parentDingtalkDeptId == null) {
      statements.push(
        `INSERT INTO departments (enterprise_id, parent_id, name, dingtalk_dept_id, status, is_default)
SELECT e.id, NULL, ${sqlLiteral(create.name)}, ${create.dingtalkDeptId}, 'active', false
FROM enterprises e
WHERE e.name = ${sqlLiteral(DINGTALK_GROUP_ENTERPRISE_NAME)}
  AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.dingtalk_dept_id = ${create.dingtalkDeptId});`,
      );
    } else {
      statements.push(
        `INSERT INTO departments (enterprise_id, parent_id, name, dingtalk_dept_id, status, is_default)
SELECT p.enterprise_id, p.id, ${sqlLiteral(create.name)}, ${create.dingtalkDeptId}, 'active', false
FROM departments p
WHERE p.dingtalk_dept_id = ${create.parentDingtalkDeptId}
  AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.dingtalk_dept_id = ${create.dingtalkDeptId});`,
      );
    }
    statements.push(
      `INSERT INTO teams (enterprise_id, department_id, name, status, is_default)
SELECT d.enterprise_id, d.id, '默认团队', 'active', true
FROM departments d
WHERE d.dingtalk_dept_id = ${create.dingtalkDeptId}
  AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.department_id = d.id AND t.is_default);`,
    );
  }
  for (const rename of plan.renames) {
    statements.push(
      `UPDATE departments SET name = ${sqlLiteral(rename.to)}, updated_at = now()
WHERE dingtalk_dept_id = ${rename.dingtalkDeptId} AND name IS DISTINCT FROM ${sqlLiteral(rename.to)};`,
    );
  }
  for (const move of plan.moves) {
    if (move.toParentDingtalkDeptId == null) {
      statements.push(
        `UPDATE departments SET parent_id = NULL, updated_at = now()
WHERE dingtalk_dept_id = ${move.dingtalkDeptId};`,
      );
    } else {
      statements.push(
        `UPDATE departments d SET parent_id = p.id, updated_at = now()
FROM departments p
WHERE d.dingtalk_dept_id = ${move.dingtalkDeptId}
  AND p.dingtalk_dept_id = ${move.toParentDingtalkDeptId};`,
      );
    }
  }
  const detail = JSON.stringify({
    source,
    creates: plan.creates.map((row) => ({
      name: row.name,
      dingtalkDeptId: row.dingtalkDeptId,
      path: row.path.join("/"),
    })),
    renames: plan.renames.map((row) => ({
      from: row.from,
      to: row.to,
      dingtalkDeptId: row.dingtalkDeptId,
    })),
    moves: plan.moves.map((row) => ({
      dingtalkDeptId: row.dingtalkDeptId,
      fromParentDingtalkDeptId: row.fromParentDingtalkDeptId,
      toParentDingtalkDeptId: row.toParentDingtalkDeptId,
      path: row.path.join("/"),
    })),
    staleCount: plan.stale.length,
    skipped: plan.skipped.map((row) => row.path.join("/")),
  });
  statements.push(
    `INSERT INTO ops_audit_logs (actor_employee_id, action, target_type, target_id, detail)
VALUES (1, 'org.dingtalk_align', 'enterprise', '1', ${sqlLiteral(detail)}::jsonb);`,
  );
  statements.push("COMMIT;");
  return statements.join("\n\n");
}
