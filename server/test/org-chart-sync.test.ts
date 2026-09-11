import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  matchSiblingDepartment,
  pickApiKeyRetargetDepartment,
  planOrgChartSync,
} = await import("../src/lib/org-chart-sync.js");

const chart = {
  deptName: "北京海致科技集团股份有限公司",
  members: [],
  children: [
    {
      deptName: "海致科技",
      members: [{ name: "万澎江" }],
      children: [
        {
          deptName: "产品技术部",
          members: [],
          children: [
            {
              deptName: "研发中心",
              members: [],
              children: [{ deptName: "前端", members: [{ name: "张三" }], children: [] }],
            },
          ],
        },
        { deptName: "售前咨询部", members: [{ name: "李四" }, { name: "连明" }], children: [] },
        { deptName: "华东事业部（科技）", members: [{ name: "陈飞阳" }], children: [] },
        {
          deptName: "AI Native前沿应用创新中心",
          members: [{ name: "张伟" }],
          children: [],
        },
        {
          deptName: "新业务孵化中心",
          members: [],
          children: [
            {
              deptName: "新行业一部",
              members: [],
              children: [{ deptName: "新行业交付一组", members: [{ name: "张伟" }], children: [] }],
            },
          ],
        },
      ],
    },
    {
      deptName: "海致星图",
      members: [],
      children: [
        {
          deptName: "能源事业部",
          members: [],
          children: [
            {
              deptName: "能源交付",
              members: [],
              children: [{ deptName: "能源湖北交付", members: [{ name: "万犇" }], children: [] }],
            },
          ],
        },
      ],
    },
  ],
};

test("sibling department matching accepts （科技） and 组 suffixes", () => {
  const siblings = [
    { id: 43, enterpriseId: 2, parentId: null, name: "华东事业部", isDefault: false },
    { id: 41, enterpriseId: 2, parentId: 10, name: "产品提效组", isDefault: false },
  ];
  assert.equal(matchSiblingDepartment("华东事业部（科技）", siblings)?.id, 43);
  assert.equal(matchSiblingDepartment("产品提效", [siblings[1]!])?.id, 41);
});

test("org chart planner creates missing nested departments and renames aliases", () => {
  const plan = planOrgChartSync({
    chart,
    enterprises: [
      { id: 2, name: "海致科技" },
      { id: 3, name: "海致星图" },
    ],
    departments: [
      { id: 8, enterpriseId: 2, parentId: null, name: "产品技术部", isDefault: false },
      { id: 23, enterpriseId: 2, parentId: 8, name: "研发中心", isDefault: false },
      { id: 43, enterpriseId: 2, parentId: null, name: "华东事业部", isDefault: false },
      { id: 6, enterpriseId: 2, parentId: null, name: "AI Native前沿应用创新中心", isDefault: false },
      { id: 1, enterpriseId: 2, parentId: null, name: "默认部门", isDefault: true },
    ],
    employees: [
      { id: 11, name: "张三", role: "employee", enterpriseId: 2, departmentIds: [23] },
      { id: 12, name: "李四", role: "employee", enterpriseId: 2, departmentIds: [99] },
      { id: 13, name: "张伟", role: "dept_admin", enterpriseId: 2, departmentIds: [6] },
      { id: 14, name: "万犇", role: "employee", enterpriseId: 2, departmentIds: [16] },
      { id: 15, name: "沙木", role: "employee", enterpriseId: 2, departmentIds: [6] },
      { id: 16, name: "海致科技", role: "org_admin", enterpriseId: 2, departmentIds: [] },
    ],
  });

  assert.deepEqual(
    plan.renameDepartments.map((row) => `${row.from}->${row.to}`),
    ["华东事业部->华东事业部（科技）"],
  );
  assert.ok(plan.createDepartments.some((row) => row.path.join("/") === "产品技术部/研发中心/前端"));
  assert.ok(plan.createDepartments.some((row) => row.path.join("/") === "售前咨询部"));
  assert.ok(plan.createDepartments.some((row) => row.path.join("/") === "能源事业部/能源交付/能源湖北交付"));

  const zhang = plan.memberships.find((row) => row.name === "张三");
  assert.deepEqual(zhang?.desiredPaths, [["产品技术部", "研发中心", "前端"]]);

  const wei = plan.memberships.find((row) => row.name === "张伟");
  assert.deepEqual(
    (wei?.desiredPaths ?? []).map((path) => path.join("/")).sort(),
    ["AI Native前沿应用创新中心", "新业务孵化中心/新行业一部/新行业交付一组"],
  );

  const wan = plan.enterpriseMoves.find((row) => row.employeeId === 14);
  assert.equal(wan?.toEnterpriseId, 3);

  assert.equal(plan.memberships.some((row) => row.name === "沙木"), false);
  assert.equal(plan.memberships.some((row) => row.name === "海致科技"), false);
  assert.ok(plan.unmatchedEmployees.some((row) => row.name === "沙木"));
});

test("API Key retarget prefers the nested destination under the department being left", () => {
  const tree = [
    { id: 9, parentId: null },
    { id: 50, parentId: 9 },
    { id: 60, parentId: 50 },
    { id: 70, parentId: null },
  ];
  assert.equal(
    pickApiKeyRetargetDepartment({
      removedDepartmentId: 50,
      desiredDepartmentIds: [60, 70],
      departments: tree,
    }),
    60,
  );
  assert.equal(
    pickApiKeyRetargetDepartment({
      removedDepartmentId: 9,
      desiredDepartmentIds: [70],
      departments: tree,
    }),
    70,
  );
});
