import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDepartmentUsageForest,
  departmentUsageRows,
  firstLevelDepartmentUsage,
} from "./department-usage-tree.ts";

const departments = [
  { id: 1, name: "默认部门", parentId: null, isDefault: true },
  { id: 8, name: "产品技术部", parentId: null },
  { id: 23, name: "研发中心", parentId: 8 },
  { id: 80, name: "前端", parentId: 23 },
  { id: 81, name: "后端", parentId: 23 },
  { id: 90, name: "测试组", parentId: 8 },
  { id: 12, name: "临时组", parentId: 1 },
  { id: 99, name: "闲置组", parentId: 8 },
];

test("parent totals include nested children and zero branches disappear", () => {
  const forest = buildDepartmentUsageForest(departments, [
    { departmentId: 80, totalTokens: 3_200, requestCount: 10 },
    { departmentId: 81, totalTokens: 4_900, requestCount: 20 },
    { departmentId: 90, totalTokens: 4_200, requestCount: 8 },
    { departmentId: 99, totalTokens: 0, requestCount: 0 },
  ]);
  assert.equal(forest.length, 1);
  assert.equal(forest[0]?.name, "产品技术部");
  assert.equal(forest[0]?.totalTokens, 12_300);
  assert.equal(forest[0]?.requestCount, 38);
  assert.deepEqual(forest[0]?.children.map((row) => row.name), ["研发中心", "测试组"]);
  assert.equal(forest[0]?.children[0]?.totalTokens, 8_100);
  assert.equal(forest[0]?.children[0]?.children.map((row) => row.name).join(","), "后端,前端");
  assert.equal(forest[0]?.children.some((row) => row.name === "闲置组"), false);
});

test("usage on a parent itself is kept in the parent total", () => {
  const forest = buildDepartmentUsageForest(departments, [
    { departmentId: 8, totalTokens: 1_000, requestCount: 2 },
    { departmentId: 90, totalTokens: 400, requestCount: 1 },
  ]);
  assert.equal(forest[0]?.ownTokens, 1_000);
  assert.equal(forest[0]?.totalTokens, 1_400);
});

test("children of 默认部门 become roots; unused named departments vanish", () => {
  const forest = buildDepartmentUsageForest(departments, [
    { departmentId: 12, totalTokens: 50, requestCount: 1 },
  ]);
  assert.deepEqual(forest.map((row) => row.name), ["临时组"]);
  assert.equal(forest[0]?.totalTokens, 50);
});

test("flatten uses tree prefixes so parents and children both show", () => {
  const rows = departmentUsageRows(departments, [
    { departmentId: 80, totalTokens: 3_200, requestCount: 10 },
    { departmentId: 81, totalTokens: 4_900, requestCount: 20 },
    { departmentId: 90, totalTokens: 4_200, requestCount: 8 },
  ]);
  assert.deepEqual(rows.map((row) => `${row.prefix}${row.name}`), [
    "产品技术部",
    "├── 研发中心",
    "│   ├── 后端",
    "│   └── 前端",
    "└── 测试组",
  ]);
  assert.equal(rows[0]?.totalTokens, 12_300);
  assert.equal(rows[1]?.totalTokens, 8_100);
  assert.equal(rows[4]?.totalTokens, 4_200);
});

test("first-level ranks roll up descendants and omit nested rows", () => {
  const rows = firstLevelDepartmentUsage(departments, [
    { departmentId: 80, totalTokens: 3_200, requestCount: 10 },
    { departmentId: 81, totalTokens: 4_900, requestCount: 20 },
    { departmentId: 90, totalTokens: 4_200, requestCount: 8 },
  ]);
  assert.deepEqual(rows.map((row) => row.departmentName), ["产品技术部"]);
  assert.equal(rows[0]?.totalTokens, 12_300);
  assert.equal(rows[0]?.requestCount, 38);
  assert.equal(rows.some((row) => row.departmentName === "研发中心"), false);
  assert.equal(rows.some((row) => row.departmentName === "前端"), false);
});

test("two first-level departments stay separate without tree prefixes", () => {
  const rows = firstLevelDepartmentUsage(
    [
      { id: 8, name: "产品技术部", parentId: null, enterpriseName: "海致科技" },
      { id: 9, name: "业务部", parentId: null, enterpriseName: "海致科技" },
      { id: 90, name: "测试组", parentId: 8 },
      { id: 91, name: "销售组", parentId: 9 },
    ],
    [
      { departmentId: 90, totalTokens: 100, requestCount: 1 },
      { departmentId: 91, totalTokens: 200, requestCount: 2 },
    ],
  );
  assert.deepEqual(rows.map((row) => row.departmentName), ["业务部", "产品技术部"]);
  assert.equal(rows[0]?.totalTokens, 200);
  assert.equal(rows[1]?.totalTokens, 100);
  assert.equal(rows[0]?.enterpriseName, "海致科技");
  assert.equal("prefix" in rows[0]!, false);
});

test("two root departments stay separate trees", () => {
  const rows = departmentUsageRows(
    [
      { id: 8, name: "产品技术部", parentId: null },
      { id: 9, name: "业务部", parentId: null },
      { id: 90, name: "测试组", parentId: 8 },
      { id: 91, name: "销售组", parentId: 9 },
    ],
    [
      { departmentId: 90, totalTokens: 100, requestCount: 1 },
      { departmentId: 91, totalTokens: 200, requestCount: 2 },
    ],
  );
  assert.deepEqual(rows.map((row) => `${row.prefix}${row.name}`), [
    "业务部",
    "└── 销售组",
    "产品技术部",
    "└── 测试组",
  ]);
});
