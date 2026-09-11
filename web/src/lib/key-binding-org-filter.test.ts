import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrgCascaderOptions,
  employeeInOrgSelection,
  groupingDepartmentId,
  orgFilterPathOf,
  parseOrgFilterPath,
  subtreeIdsForSelection,
} from "./key-binding-org-filter.ts";

const enterprises = [
  { id: 2, name: "海致科技" },
  { id: 3, name: "海致星图" },
];

const departments = [
  { id: 1, name: "默认部门", parentId: null, enterpriseId: 2, isDefault: true },
  { id: 8, name: "产品技术部", parentId: null, enterpriseId: 2 },
  { id: 23, name: "研发中心", parentId: 8, enterpriseId: 2 },
  { id: 80, name: "前端", parentId: 23, enterpriseId: 2 },
  { id: 9, name: "业务产品技术部", parentId: null, enterpriseId: 2 },
  { id: 20, name: "产品组", parentId: 9, enterpriseId: 2 },
  { id: 5, name: "产品研发中心", parentId: null, enterpriseId: 3 },
  { id: 37, name: "图数据库研发", parentId: 5, enterpriseId: 3 },
];

test("cascader nests enterprise then departments and skips 默认部门", () => {
  const options = buildOrgCascaderOptions(enterprises, departments);
  assert.deepEqual(options.map((row) => row.label), ["海致科技", "海致星图"]);
  const keji = options[0];
  assert.equal(keji?.value, "ent:2");
  assert.deepEqual(keji?.children?.map((row) => row.label), ["产品技术部", "业务产品技术部"]);
  const product = keji?.children?.find((row) => row.value === "dept:8");
  assert.deepEqual(product?.children?.map((row) => row.label), ["研发中心"]);
  assert.deepEqual(
    product?.children?.[0]?.children?.map((row) => row.label),
    ["前端"],
  );
  assert.equal(
    JSON.stringify(options).includes("默认部门"),
    false,
  );
});

test("filter path round-trips enterprise and nested department", () => {
  assert.deepEqual(parseOrgFilterPath(["ent:2"]), { kind: "enterprise", enterpriseId: 2 });
  assert.deepEqual(parseOrgFilterPath(["ent:2", "dept:8", "dept:23"]), {
    kind: "department",
    enterpriseId: 2,
    departmentId: 23,
  });
  assert.deepEqual(
    orgFilterPathOf({ kind: "department", enterpriseId: 2, departmentId: 80 }, departments),
    ["ent:2", "dept:8", "dept:23", "dept:80"],
  );
});

test("canvas grouping uses the selected org level, not the leaf", () => {
  const enterprise = { kind: "enterprise" as const, enterpriseId: 2 };
  assert.equal(groupingDepartmentId(80, enterprise, departments), 8);
  assert.equal(groupingDepartmentId(20, enterprise, departments), 9);

  const product = { kind: "department" as const, enterpriseId: 2, departmentId: 8 };
  assert.equal(groupingDepartmentId(80, product, departments), 23);
  assert.equal(groupingDepartmentId(8, product, departments), 8);

  const frontend = { kind: "department" as const, enterpriseId: 2, departmentId: 80 };
  assert.equal(groupingDepartmentId(80, frontend, departments), 80);
});

test("employees follow the selected subtree", () => {
  const product = { kind: "department" as const, enterpriseId: 2, departmentId: 8 };
  const subtree = subtreeIdsForSelection(product, departments);
  assert.equal(
    employeeInOrgSelection({ enterpriseId: 2, departmentId: 80 }, product, subtree),
    true,
  );
  assert.equal(
    employeeInOrgSelection({ enterpriseId: 2, departmentId: 20 }, product, subtree),
    false,
  );
  const keji = { kind: "enterprise" as const, enterpriseId: 2 };
  assert.equal(
    employeeInOrgSelection({ enterpriseId: 2, departmentId: 20 }, keji, subtreeIdsForSelection(keji, departments)),
    true,
  );
  assert.equal(
    employeeInOrgSelection({ enterpriseId: 3, departmentId: 37 }, keji, subtreeIdsForSelection(keji, departments)),
    false,
  );
});
