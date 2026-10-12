import { readFileSync, writeFileSync } from "node:fs";
import "../config.js";
import { env } from "../config.js";
import {
  fetchDingtalkAccessToken,
  fetchDingtalkDepartmentTree,
  fetchDingtalkDeptUsers,
  mergeDingtalkUserDetails,
  readDingtalkCredentials,
  type DingtalkUserDetail,
} from "../lib/dingtalk-department-tree.js";
import { normalizeDingtalkMobile } from "../lib/dingtalk-user-import.js";

type FlatNode = { deptId: number };

async function main() {
  const argv = process.argv.slice(2);
  const fromJsonIdx = argv.indexOf("--from-tree-json");
  const out = argv[argv.indexOf("--out") + 1];
  if (!out || argv.indexOf("--out") < 0) throw new Error("--out 需要文件路径");
  const credentials = readDingtalkCredentials(env);
  if (!credentials) throw new Error("未配置钉钉 AppKey / AppSecret");
  const token = await fetchDingtalkAccessToken(credentials);
  let deptIds: number[];
  if (fromJsonIdx >= 0) {
    const path = argv[fromJsonIdx + 1];
    if (!path) throw new Error("--from-tree-json 需要文件路径");
    const payload = JSON.parse(readFileSync(path, "utf8")) as { nodes: FlatNode[] };
    deptIds = payload.nodes.map((node) => node.deptId);
  } else {
    const tree = await fetchDingtalkDepartmentTree(credentials);
    const ids: number[] = [];
    const walk = (node: { deptId: number; children: typeof tree[] }) => {
      ids.push(node.deptId);
      for (const child of node.children) walk(child);
    };
    walk(tree);
    deptIds = ids;
  }
  const byUserid = new Map<string, DingtalkUserDetail>();
  for (const deptId of deptIds) {
    const users = await fetchDingtalkDeptUsers({ token, deptId });
    for (const user of users) {
      const existing = byUserid.get(user.userid);
      byUserid.set(user.userid, existing ? mergeDingtalkUserDetails(existing, user) : user);
    }
  }
  const users = [...byUserid.values()].map((user) => ({
    userid: user.userid,
    name: user.name,
    phone: normalizeDingtalkMobile(user.mobile),
    mobile: user.mobile,
    email: user.email,
    deptIds: user.deptIds,
    title: user.title,
    hiredAt: user.hiredAt,
    jobNumber: user.jobNumber,
    workPlace: user.workPlace,
    remark: user.remark,
    managerUserid: user.managerUserid,
    deptOrderList: user.deptOrderList,
    leaderInDept: user.leaderInDept,
    roleList: user.roleList,
  }));
  writeFileSync(
    out,
    JSON.stringify({ fetchedAt: new Date().toISOString(), deptCount: deptIds.length, count: users.length, users }, null, 2),
  );
  const missingPhone = users.filter((user) => !user.phone).length;
  console.log(JSON.stringify({ out, users: users.length, depts: deptIds.length, missingPhone }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
