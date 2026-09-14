import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { orgConsoleUserListParams } from "./org-console-loads.ts";

test("org console people page is 10 rows and scoped to the selected enterprise", () => {
  assert.deepEqual(
    orgConsoleUserListParams({ enterpriseId: 3, departmentId: null, page: 1 }),
    { enterpriseId: 3, limit: 10, offset: 0 },
  );
  assert.deepEqual(
    orgConsoleUserListParams({ enterpriseId: 3, departmentId: 41, page: 2 }),
    { enterpriseId: 3, departmentId: 41, limit: 10, offset: 10 },
  );
});

test("org console people search matches name or phone across the enterprise", () => {
  assert.deepEqual(
    orgConsoleUserListParams({ enterpriseId: 3, departmentId: null, page: 1, q: " 张三 " }),
    { enterpriseId: 3, q: "张三", limit: 10, offset: 0 },
  );
  assert.deepEqual(
    orgConsoleUserListParams({ enterpriseId: 3, departmentId: 41, page: 1, q: "13800138000" }),
    { enterpriseId: 3, q: "13800138000", limit: 10, offset: 0 },
  );
  assert.deepEqual(
    orgConsoleUserListParams({ enterpriseId: 3, departmentId: 41, page: 2, q: "  " }),
    { enterpriseId: 3, departmentId: 41, limit: 10, offset: 10 },
  );
});

test("org console does not fan out one members request per department team", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const view = readFileSync(resolve(root, "src/views/admin/EnterprisesView.vue"), "utf8");
  assert.doesNotMatch(view, /\/api\/admin\/teams\/\$\{team\.id\}\/members/);
  assert.match(view, /orgConsoleUserListParams/);
  assert.doesNotMatch(view, /limit:\s*200/);
});

test("org console people pane searches employees by name or phone", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const view = readFileSync(resolve(root, "src/views/admin/EnterprisesView.vue"), "utf8");
  assert.match(view, /搜索姓名或手机号/);
  assert.match(view, /employeeQuery/);
  assert.match(view, /orgConsoleUserListParams\(\{[\s\S]*q:/);
});
