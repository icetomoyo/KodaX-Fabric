import { readFileSync, writeFileSync } from "node:fs";
import "../config.js";
import { env } from "../config.js";
import { db } from "./client.js";
import { departments } from "./schema/index.js";
import {
  fetchDingtalkDepartmentTree,
  readDingtalkCredentials,
  type DingtalkDepartmentNode,
} from "../lib/dingtalk-department-tree.js";
import {
  departmentTreeSyncSql,
  planDingtalkDepartmentTreeSync,
} from "../lib/dingtalk-dept-id-map.js";

type FlatNode = {
  deptId: number;
  name: string;
  parentId: number;
  path: string[];
};

function treeFromFlat(nodes: FlatNode[]): DingtalkDepartmentNode {
  const byId = new Map<number, DingtalkDepartmentNode>();
  for (const node of nodes) {
    byId.set(node.deptId, {
      deptId: node.deptId,
      name: node.name,
      parentId: node.parentId,
      children: [],
    });
  }
  let root: DingtalkDepartmentNode | undefined;
  for (const node of nodes) {
    const current = byId.get(node.deptId);
    if (!current) continue;
    if (node.deptId === 1) {
      root = current;
      continue;
    }
    const parent = byId.get(node.parentId);
    if (parent) parent.children.push(current);
    else root = root ?? current;
  }
  if (!root) throw new Error("钉钉部门树缺少根节点");
  return root;
}

async function loadTree(argv: string[]): Promise<DingtalkDepartmentNode> {
  const fromJsonIdx = argv.indexOf("--from-json");
  if (fromJsonIdx >= 0) {
    const path = argv[fromJsonIdx + 1];
    if (!path) throw new Error("--from-json 需要文件路径");
    const payload = JSON.parse(readFileSync(path, "utf8")) as { nodes: FlatNode[] };
    return treeFromFlat(payload.nodes);
  }
  const credentials = readDingtalkCredentials(env);
  if (!credentials) throw new Error("未配置钉钉 AppKey / AppSecret");
  return fetchDingtalkDepartmentTree(credentials);
}

async function main() {
  const argv = process.argv.slice(2);
  const source =
    argv.find((item, index) => argv[index - 1] === "--source") ??
    `dingtalk-dept-tree-sync-${new Date().toISOString().slice(0, 10)}`;
  const sqlOutIdx = argv.indexOf("--sql-out");
  const sqlOut = sqlOutIdx >= 0 ? argv[sqlOutIdx + 1] : undefined;
  const tree = await loadTree(argv);
  const departmentRows = await db
    .select({
      id: departments.id,
      parentId: departments.parentId,
      name: departments.name,
      isDefault: departments.isDefault,
      dingtalkDeptId: departments.dingtalkDeptId,
    })
    .from(departments);
  const plan = planDingtalkDepartmentTreeSync({ tree, departments: departmentRows });
  const sql = departmentTreeSyncSql(plan, source);
  if (sqlOut) writeFileSync(sqlOut, `${sql}\n`);
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        source,
        creates: plan.creates.length,
        renames: plan.renames.length,
        moves: plan.moves.length,
        skipped: plan.skipped.length,
        stale: plan.stale.length,
        sampleCreates: plan.creates.slice(0, 12).map((row) => row.path.join("/")),
        renameList: plan.renames.map((row) => `${row.from} -> ${row.to}`),
        moveList: plan.moves.map((row) => row.path.join("/")),
        sqlOut: sqlOut ?? null,
      },
      null,
      2,
    ),
  );
  if (!sqlOut) process.stderr.write(sql);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
