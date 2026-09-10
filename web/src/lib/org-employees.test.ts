import assert from "node:assert/strict";
import test from "node:test";
import {
  employeeDepartmentLabel,
  visibleOrgEmployees,
} from "./org-employees.ts";

const departments = [
  { id: 8, parentId: null, name: "产品技术部" },
  { id: 18, parentId: 8, name: "平台组" },
  { id: 9, parentId: null, name: "金融事业部" },
  { id: 1, parentId: null, name: "默认部门", isDefault: true },
];

const teams = [
  { id: 101, departmentId: 8, name: "默认团队", departmentName: "产品技术部", isDefault: true },
  { id: 102, departmentId: 18, name: "默认团队", departmentName: "平台组", isDefault: true },
  { id: 103, departmentId: 9, name: "默认团队", departmentName: "金融事业部", isDefault: true },
  { id: 104, departmentId: 1, name: "默认团队", departmentName: "默认部门", isDefault: true },
];

const employees = [
  { id: 1, name: "张三", teamId: 101 },
  { id: 2, name: "李四", teamId: 102 },
  { id: 3, name: "王五", teamId: 103 },
  { id: 4, name: "赵六", teamId: 104 },
  { id: 5, name: "未分配", teamId: null },
];

test("selecting an enterprise lists department members even when every remaining team is default", () => {
  const rows = visibleOrgEmployees({
    isTeamAdmin: false,
    selectedKind: "enterprise",
    selectedDepartmentId: null,
    employees,
    teams,
    departments,
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    [1, 2, 3, 4, 5],
  );
});

test("selecting a department lists members of that node and nested children only", () => {
  const rows = visibleOrgEmployees({
    isTeamAdmin: false,
    selectedKind: "department",
    selectedDepartmentId: 8,
    employees,
    teams,
    departments,
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    [1, 2],
  );
});

test("employee department column uses the department name, not 默认团队", () => {
  assert.equal(
    employeeDepartmentLabel({ teamId: 101, fallbackName: "默认团队", teams, departments }),
    "产品技术部",
  );
  assert.equal(
    employeeDepartmentLabel({ teamId: 102, fallbackName: "默认团队", teams, departments }),
    "平台组",
  );
  assert.equal(
    employeeDepartmentLabel({ teamId: 104, fallbackName: "默认团队", teams, departments }),
    null,
  );
  assert.equal(
    employeeDepartmentLabel({ teamId: null, fallbackName: "默认团队", teams, departments }),
    null,
  );
});
