export type DepartmentTreeNode = {
  id: number;
  parentId: number | null;
};

function indexById(
  nodes: readonly DepartmentTreeNode[],
): Map<number, DepartmentTreeNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/**
 * Walk to the 一级部门: the ancestor whose parent is the enterprise (parentId is null).
 * Unknown ids are returned unchanged.
 */
export function firstLevelDepartmentId(
  departmentId: number,
  nodes: readonly DepartmentTreeNode[],
): number {
  const byId = indexById(nodes);
  const seen = new Set<number>();
  let current = byId.get(departmentId);
  if (!current) return departmentId;
  while (current.parentId != null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

export function descendantDepartmentIds(
  rootId: number,
  nodes: readonly DepartmentTreeNode[],
): number[] {
  const children = new Map<number, number[]>();
  for (const node of nodes) {
    if (node.parentId == null) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  const out: number[] = [];
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    const nested = children.get(id);
    if (nested?.length) stack.push(...nested);
  }
  return out;
}

export function departmentAndDescendantIds(
  rootId: number,
  nodes: readonly DepartmentTreeNode[],
): number[] {
  return [rootId, ...descendantDepartmentIds(rootId, nodes)];
}
