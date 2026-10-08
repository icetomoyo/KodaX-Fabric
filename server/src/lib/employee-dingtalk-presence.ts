import { and, eq, inArray } from "drizzle-orm";
import { env } from "../config.js";
import { db } from "../db/client.js";
import { employees, enterprises } from "../db/schema/index.js";
import {
  collectDingtalkDeptIds,
  dingtalkOrgEmployeePatch,
  enrichDingtalkUsersWithGet,
  fetchDingtalkAccessToken,
  fetchDingtalkDepartmentTree,
  fetchDingtalkDeptUsers,
  findDingtalkNode,
  mergeDingtalkUserDetails,
  readDingtalkCredentials,
  DingtalkNotConfiguredError,
  type DingtalkCredentials,
  type DingtalkUserDetail,
} from "./dingtalk-department-tree.js";
import { normalizeDingtalkMobile } from "./dingtalk-user-import.js";

export type DingtalkPresenceEnterpriseResult = {
  enterpriseId: number;
  name: string;
  dingtalkDeptId: number | null;
  rosterPhones: number;
  markedIn: number;
  markedOut: number;
  profilesUpdated: number;
};

type FetchImpl = typeof fetch;

export async function refreshEmployeeDingtalkPresence(options?: {
  credentials?: DingtalkCredentials | null;
  fetchImpl?: FetchImpl;
  dryRun?: boolean;
}): Promise<DingtalkPresenceEnterpriseResult[]> {
  const credentials =
    options?.credentials === undefined ? readDingtalkCredentials(env) : options.credentials;
  if (!credentials) throw new DingtalkNotConfiguredError();

  const enterpriseRows = await db
    .select({
      id: enterprises.id,
      name: enterprises.name,
      dingtalkDeptId: enterprises.dingtalkDeptId,
    })
    .from(enterprises);

  const tree = await fetchDingtalkDepartmentTree({
    appKey: credentials.appKey,
    appSecret: credentials.appSecret,
    fetchImpl: options?.fetchImpl,
  });
  const token = await fetchDingtalkAccessToken({
    appKey: credentials.appKey,
    appSecret: credentials.appSecret,
    fetchImpl: options?.fetchImpl,
  });

  const phonesByDept = new Map<number, string[]>();
  const listedByUserid = new Map<string, DingtalkUserDetail>();
  for (const deptId of collectDingtalkDeptIds(tree)) {
    const users = await fetchDingtalkDeptUsers({
      token,
      deptId,
      fetchImpl: options?.fetchImpl,
    });
    const phones: string[] = [];
    for (const user of users) {
      const existing = listedByUserid.get(user.userid);
      listedByUserid.set(user.userid, existing ? mergeDingtalkUserDetails(existing, user) : user);
      const phone = normalizeDingtalkMobile(user.mobile);
      if (!phone) continue;
      phones.push(phone);
    }
    phonesByDept.set(deptId, phones);
  }
  const enriched = await enrichDingtalkUsersWithGet({
    token,
    users: [...listedByUserid.values()],
    fetchImpl: options?.fetchImpl,
  });
  const profilesByPhone = new Map<string, DingtalkUserDetail>();
  for (const user of enriched) {
    const phone = normalizeDingtalkMobile(user.mobile);
    if (phone) profilesByPhone.set(phone, user);
  }

  const results: DingtalkPresenceEnterpriseResult[] = [];
  for (const enterprise of enterpriseRows) {
    const roster = new Set<string>();
    if (enterprise.dingtalkDeptId != null) {
      const node = findDingtalkNode(tree, enterprise.dingtalkDeptId);
      if (node) {
        for (const deptId of collectDingtalkDeptIds(node)) {
          for (const phone of phonesByDept.get(deptId) ?? []) roster.add(phone);
        }
      }
    }
    const current = await db
      .select({ id: employees.id, phone: employees.phone })
      .from(employees)
      .where(eq(employees.enterpriseId, enterprise.id));
    const inIds = current
      .filter((row) => {
        const normalized = normalizeDingtalkMobile(row.phone) ?? row.phone;
        return roster.has(row.phone) || roster.has(normalized);
      })
      .map((row) => row.id);
    const markedIn = inIds.length;
    const markedOut = current.length - markedIn;
    const profileUpdates = current.flatMap((row) => {
      const normalized = normalizeDingtalkMobile(row.phone) ?? row.phone;
      const profile = profilesByPhone.get(row.phone) ?? profilesByPhone.get(normalized);
      if (!profile) return [];
      return [{ id: row.id, profile }];
    });

    if (!options?.dryRun) {
      await db.transaction(async (tx) => {
        await tx
          .update(employees)
          .set({ isDingtalk: false })
          .where(eq(employees.enterpriseId, enterprise.id));
        if (inIds.length > 0) {
          await tx
            .update(employees)
            .set({ isDingtalk: true })
            .where(and(eq(employees.enterpriseId, enterprise.id), inArray(employees.id, inIds)));
        }
        for (const row of profileUpdates) {
          await tx
            .update(employees)
            .set({
              ...dingtalkOrgEmployeePatch(row.profile),
              updatedAt: new Date(),
            })
            .where(eq(employees.id, row.id));
        }
      });
    }

    results.push({
      enterpriseId: enterprise.id,
      name: enterprise.name,
      dingtalkDeptId: enterprise.dingtalkDeptId,
      rosterPhones: roster.size,
      markedIn,
      markedOut,
      profilesUpdated: profileUpdates.length,
    });
  }
  return results;
}
