import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { parseActAsHeader } = await import("../src/lib/act-as.js");
const { loadOrgActor } = await import("../src/lib/org.js");

test("act-as header parses org/dept/team payloads and rejects incomplete ones", () => {
  assert.equal(parseActAsHeader(undefined), null);
  assert.equal(parseActAsHeader(""), null);
  assert.deepEqual(
    parseActAsHeader(JSON.stringify({ role: "org_admin", enterpriseId: 8 })),
    { role: "org_admin", enterpriseId: 8 },
  );
  assert.deepEqual(
    parseActAsHeader(JSON.stringify({
      role: "dept_admin",
      enterpriseId: 8,
      departmentId: 3,
    })),
    { role: "dept_admin", enterpriseId: 8, departmentId: 3 },
  );
  assert.equal(
    (parseActAsHeader(JSON.stringify({ role: "dept_admin", enterpriseId: 8 })) as { invalid: true }).invalid,
    true,
  );
  assert.deepEqual(
    parseActAsHeader(JSON.stringify({
      role: "employee",
      enterpriseId: 8,
      employeeId: 41,
    })),
    { role: "employee", enterpriseId: 8, employeeId: 41 },
  );
  assert.equal(
    (parseActAsHeader(JSON.stringify({ role: "employee", enterpriseId: 8 })) as { invalid: true }).invalid,
    true,
  );
  assert.equal(
    (parseActAsHeader(JSON.stringify({ role: "admin", enterpriseId: 8 })) as { invalid: true }).invalid,
    true,
  );
  assert.equal((parseActAsHeader("{") as { invalid: true }).invalid, true);
});

test("org actor uses explicit department ids for impersonated dept_admin", async () => {
  const actor = await loadOrgActor({
    role: "dept_admin",
    enterpriseId: 8,
    employeeId: 99,
    departmentIds: [12],
  });
  assert.deepEqual(actor.departmentIds, [12]);
});

test("admin shell keeps the act-as switch for true super admins", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const layout = readFileSync(resolve(root, "web/src/layouts/AdminLayout.vue"), "utf8");
  const http = readFileSync(resolve(root, "web/src/api/http.ts"), "utf8");
  const auth = readFileSync(resolve(root, "web/src/stores/auth.ts"), "utf8");
  assert.match(layout, /切换临时权限/);
  assert.match(layout, /canSwitchActAs/);
  assert.match(layout, /ActAsDrawer/);
  assert.match(http, /X-Act-As/);
  assert.match(http, /INVALID_ACT_AS/);
  assert.match(auth, /canSwitchActAs/);
  assert.match(auth, /trueRole/);
  const meLayout = readFileSync(resolve(root, "web/src/layouts/MeLayout.vue"), "utf8");
  const drawer = readFileSync(resolve(root, "web/src/views/admin/ActAsDrawer.vue"), "utf8");
  assert.match(meLayout, /切换临时权限/);
  assert.match(drawer, /role: 'employee'/);
});
