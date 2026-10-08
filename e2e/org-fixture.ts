/**
 * E2E 组织夹具：由 seed-org.ts 写入测试库，不走 admin POST。
 * 钉钉 ID 使用 90000x，避开真实通讯录。
 * ORG_UNITS_SYNC_ONLY_MESSAGE 必须与 server/src/lib/enterprise.ts 保持一致。
 */
export const ORG_UNITS_SYNC_ONLY_MESSAGE = "子公司和部门只能通过同步钉钉创建";

export const E2E_ORG = {
  group: { name: "海致集团", dingtalkDeptId: 1 },
  childA: { name: "E2E子企业甲", dingtalkDeptId: 900001 },
  childB: { name: "E2E子企业乙", dingtalkDeptId: 900002 },
  department: { name: "E2E部门", dingtalkDeptId: 900003 },
  departmentB: { name: "E2E华东组", dingtalkDeptId: 900004 },
  employees: {
    childA: {
      name: "E2E员工甲",
      phone: "13800000011",
      jobTitle: "E2E工程师",
      hiredAt: "2024-03-01",
    },
    childB: { name: "E2E员工乙", phone: "13800000012" },
  },
} as const;
