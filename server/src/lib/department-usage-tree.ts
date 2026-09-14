export type DepartmentUsageInput = {
  id: number;
  parentId?: number | null;
  name: string;
  isDefault?: boolean;
  enterpriseName?: string | null;
};

export type DepartmentOwnUsage = {
  departmentId: number;
  totalTokens: number;
  requestCount: number;
};

export type DepartmentUsageNode = {
  id: number;
  name: string;
  ownTokens: number;
  ownRequests: number;
  totalTokens: number;
  requestCount: number;
  children: DepartmentUsageNode[];
};

export type DepartmentUsageRow = {
  id: number;
  name: string;
  prefix: string;
  depth: number;
  totalTokens: number;
  requestCount: number;
};

function usageOf(own: ReadonlyMap<number, DepartmentOwnUsage>, id: number) {
  const row = own.get(id);
  return {
    totalTokens: Number(row?.totalTokens) || 0,
    requestCount: Number(row?.requestCount) || 0,
  };
}

function rollup(node: DepartmentUsageNode) {
  let tokens = node.ownTokens;
  let requests = node.ownRequests;
  for (const child of node.children) {
    rollup(child);
    tokens += child.totalTokens;
    requests += child.requestCount;
  }
  node.totalTokens = tokens;
  node.requestCount = requests;
}

function pruneZero(nodes: DepartmentUsageNode[]): DepartmentUsageNode[] {
  const kept: DepartmentUsageNode[] = [];
  for (const node of nodes) {
    node.children = pruneZero(node.children);
    if (node.totalTokens > 0) kept.push(node);
  }
  return kept;
}

function byUsageThenName(left: DepartmentUsageNode, right: DepartmentUsageNode) {
  if (right.totalTokens !== left.totalTokens) return right.totalTokens - left.totalTokens;
  return left.name.localeCompare(right.name, "zh-CN");
}

function sortTree(nodes: DepartmentUsageNode[]) {
  nodes.sort(byUsageThenName);
  for (const node of nodes) sortTree(node.children);
}

/**
 * Inclusive department usage forest. Skips 默认部门 (its children become roots).
 * Parent totals include every descendant. Nodes with 0 subtree usage are dropped.
 */
export function buildDepartmentUsageForest(
  departments: readonly DepartmentUsageInput[],
  ownUsage: readonly DepartmentOwnUsage[],
): DepartmentUsageNode[] {
  const own = new Map(ownUsage.map((row) => [row.departmentId, row]));
  const named = departments.filter((row) => !row.isDefault);
  const namedIds = new Set(named.map((row) => row.id));
  const nodes = new Map<number, DepartmentUsageNode>();
  for (const department of named) {
    const usage = usageOf(own, department.id);
    nodes.set(department.id, {
      id: department.id,
      name: department.name,
      ownTokens: usage.totalTokens,
      ownRequests: usage.requestCount,
      totalTokens: 0,
      requestCount: 0,
      children: [],
    });
  }
  const roots: DepartmentUsageNode[] = [];
  for (const department of named) {
    const node = nodes.get(department.id);
    if (!node) continue;
    const parentId = department.parentId ?? null;
    const parent = parentId != null && namedIds.has(parentId) ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  for (const root of roots) rollup(root);
  const visible = pruneZero(roots);
  sortTree(visible);
  return visible;
}

export function flattenDepartmentUsageForest(
  forest: readonly DepartmentUsageNode[],
): DepartmentUsageRow[] {
  const rows: DepartmentUsageRow[] = [];
  function walk(
    node: DepartmentUsageNode,
    gutter: string,
    isLast: boolean,
    isRoot: boolean,
    depth: number,
  ) {
    const branch = isRoot ? "" : isLast ? "└── " : "├── ";
    rows.push({
      id: node.id,
      name: node.name,
      prefix: `${gutter}${branch}`,
      depth,
      totalTokens: node.totalTokens,
      requestCount: node.requestCount,
    });
    const nextGutter = isRoot ? "" : `${gutter}${isLast ? "    " : "│   "}`;
    node.children.forEach((child, index) => {
      walk(child, nextGutter, index === node.children.length - 1, false, depth + 1);
    });
  }
  forest.forEach((root) => walk(root, "", true, true, 0));
  return rows;
}

export function departmentUsageRows(
  departments: readonly DepartmentUsageInput[],
  ownUsage: readonly DepartmentOwnUsage[],
): DepartmentUsageRow[] {
  return flattenDepartmentUsageForest(buildDepartmentUsageForest(departments, ownUsage));
}

export type FirstLevelDepartmentUsageRow = {
  departmentId: number;
  departmentName: string;
  enterpriseName?: string;
  totalTokens: number;
  requestCount: number;
};

/**
 * First-level department ranks only. Totals include every descendant.
 * Nested departments are never emitted as their own rows.
 */
export function firstLevelDepartmentUsage(
  departments: readonly DepartmentUsageInput[],
  ownUsage: readonly DepartmentOwnUsage[],
  limit = 10,
): FirstLevelDepartmentUsageRow[] {
  const byId = new Map(departments.map((row) => [row.id, row]));
  return buildDepartmentUsageForest(departments, ownUsage)
    .slice(0, limit)
    .map((row) => {
      const enterpriseName = byId.get(row.id)?.enterpriseName?.trim();
      return {
        departmentId: row.id,
        departmentName: row.name,
        ...(enterpriseName ? { enterpriseName } : {}),
        totalTokens: row.totalTokens,
        requestCount: row.requestCount,
      };
    });
}
