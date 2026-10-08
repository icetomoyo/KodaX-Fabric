import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { departments, enterprises } from "../db/schema/index.js";

export type DingtalkDeptIdOwner =
  | { kind: "enterprise"; id: number; name: string }
  | { kind: "department"; id: number; name: string };

export async function findDingtalkDeptIdOwner(
  dingtalkDeptId: number,
  except?: { enterpriseId?: number; departmentId?: number },
): Promise<DingtalkDeptIdOwner | null> {
  const enterpriseFilter =
    except?.enterpriseId != null
      ? and(eq(enterprises.dingtalkDeptId, dingtalkDeptId), ne(enterprises.id, except.enterpriseId))
      : eq(enterprises.dingtalkDeptId, dingtalkDeptId);
  const [enterprise] = await db
    .select({ id: enterprises.id, name: enterprises.name })
    .from(enterprises)
    .where(enterpriseFilter)
    .limit(1);
  if (enterprise) return { kind: "enterprise", id: enterprise.id, name: enterprise.name };

  const departmentFilter =
    except?.departmentId != null
      ? and(eq(departments.dingtalkDeptId, dingtalkDeptId), ne(departments.id, except.departmentId))
      : eq(departments.dingtalkDeptId, dingtalkDeptId);
  const [department] = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(departmentFilter)
    .limit(1);
  if (department) return { kind: "department", id: department.id, name: department.name };
  return null;
}

export function dingtalkDeptIdConflictMessage(owner: DingtalkDeptIdOwner): string {
  return owner.kind === "enterprise"
    ? `钉钉部门 ID 已被企业「${owner.name}」占用`
    : `钉钉部门 ID 已被部门「${owner.name}」占用`;
}

export async function loadEnterpriseParentChain(id: number): Promise<number[]> {
  const chain: number[] = [];
  const seen = new Set<number>();
  let current: number | null = id;
  while (current != null && !seen.has(current) && chain.length < 32) {
    seen.add(current);
    chain.push(current);
    const [row] = await db
      .select({ parentId: enterprises.parentId })
      .from(enterprises)
      .where(eq(enterprises.id, current))
      .limit(1);
    current = row?.parentId ?? null;
  }
  return chain;
}
