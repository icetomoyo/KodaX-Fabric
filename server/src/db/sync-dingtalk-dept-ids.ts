import "../config.js";
import { db } from "./client.js";
import { departments, enterprises } from "./schema/index.js";
import { fetchDingtalkDepartmentTree, readDingtalkCredentials } from "../lib/dingtalk-department-tree.js";
import { planDingtalkDeptIdWrites } from "../lib/dingtalk-dept-id-map.js";
import { env } from "../config.js";
import { eq } from "drizzle-orm";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const credentials = readDingtalkCredentials(env);
  if (!credentials) {
    throw new Error("未配置钉钉 AppKey / AppSecret");
  }
  const [tree, enterpriseRows, departmentRows] = await Promise.all([
    fetchDingtalkDepartmentTree(credentials),
    db.select({ id: enterprises.id, name: enterprises.name }).from(enterprises),
    db
      .select({
        id: departments.id,
        enterpriseId: departments.enterpriseId,
        parentId: departments.parentId,
        name: departments.name,
        isDefault: departments.isDefault,
      })
      .from(departments),
  ]);
  const plan = planDingtalkDeptIdWrites({
    tree,
    enterprises: enterpriseRows,
    departments: departmentRows,
  });
  if (!dryRun) {
    for (const write of plan.writes) {
      await db
        .update(departments)
        .set({ dingtalkDeptId: write.dingtalkDeptId, updatedAt: new Date() })
        .where(eq(departments.id, write.departmentId));
    }
  }
  console.log(
    JSON.stringify(
      {
        dryRun,
        writes: plan.writes.length,
        skipped: plan.skipped,
        unmatchedDingtalk: plan.unmatchedDingtalk,
        sample: plan.writes.slice(0, 8),
      },
      null,
      2,
    ),
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
