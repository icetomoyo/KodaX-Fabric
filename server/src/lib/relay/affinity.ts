/**
 * 渠道 Key 亲和度：请求人和 Key 的席位主人在编制上离得越近，分数越高。
 * 调度按分数从高到低选 Key，分数只决定顺序，不做加权。
 *
 * - 100：本人的席位 Key
 * -  90：和主人直属同一个部门（同组）
 * -  80：和主人同属某个一级部门以下的部门（同部门）
 * -  70：和主人同属一个一级部门
 * -  60：只是同一家企业
 *
 * 一个人可以直属多个部门，取所有组合里最高的那个分数。
 *
 * 渠道 Key 都来自席位。充值模式下管理员直接添加的 Key 没有席位主人，
 * 谈不上亲疏，按「只是同一家企业」计分。
 */
export const AFFINITY_OWN = 100;
export const AFFINITY_SAME_DEPARTMENT = 90;
export const AFFINITY_SHARED_SUB_DEPARTMENT = 80;
export const AFFINITY_SAME_FIRST_LEVEL = 70;
export const AFFINITY_SAME_ENTERPRISE = 60;

export type AffinityDepartmentNode = {
  id: number;
  parentId: number | null;
};

/** 从一级部门到该部门的路径（含自身）。未知部门返回空数组。 */
export function departmentRootPath(
  departmentId: number,
  parentById: ReadonlyMap<number, number | null>,
): number[] {
  const path: number[] = [];
  const seen = new Set<number>();
  let current: number | null | undefined = departmentId;
  while (current != null && parentById.has(current) && !seen.has(current)) {
    seen.add(current);
    path.push(current);
    current = parentById.get(current);
  }
  return path.reverse();
}

function commonPrefixLength(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let index = 0;
  while (index < length && a[index] === b[index]) index += 1;
  return index;
}

/**
 * 请求人与 Key 主人的编制亲和度（两人已确认同属一家企业）。
 * 传入的是各自直属的部门 ID。
 */
export function departmentAffinity(
  requesterDepartmentIds: readonly number[],
  ownerDepartmentIds: readonly number[],
  nodes: readonly AffinityDepartmentNode[],
): number {
  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
  const ownerPaths = ownerDepartmentIds.map((id) => departmentRootPath(id, parentById));
  let best = AFFINITY_SAME_ENTERPRISE;
  for (const requesterDepartmentId of requesterDepartmentIds) {
    if (ownerDepartmentIds.includes(requesterDepartmentId)) return AFFINITY_SAME_DEPARTMENT;
    const requesterPath = departmentRootPath(requesterDepartmentId, parentById);
    for (const ownerPath of ownerPaths) {
      const shared = commonPrefixLength(requesterPath, ownerPath);
      if (shared >= 2) {
        best = Math.max(best, AFFINITY_SHARED_SUB_DEPARTMENT);
      } else if (shared === 1) {
        best = Math.max(best, AFFINITY_SAME_FIRST_LEVEL);
      }
    }
  }
  return best;
}
