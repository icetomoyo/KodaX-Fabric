import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { adminLogRoutes } = await import("../src/routes/admin/logs.js");
const { formatOpsAuditTargetLabel } = await import("../src/lib/ops-audit.js");

test("admin log routes expose list, detail, and context download", async () => {
  const app = Fastify();
  await app.register(adminLogRoutes);
  await app.ready();

  try {
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/logs" }), true);
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/logs/:requestId" }), true);
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/logs/:requestId/context" }), true);
    const unauth = await app.inject({ method: "GET", url: "/api/admin/logs" });
    assert.equal(unauth.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("admin logs page shows token and credit input/output/cache/total columns", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const view = readFileSync(resolve(root, "web/src/views/admin/LogsView.vue"), "utf8");
  assert.match(view, /label="Tokens"/);
  assert.match(view, />折扣</);
  assert.match(view, /label="积分折扣"/);
  assert.match(view, /label="积分"/);
  assert.match(view, /label="输入"/);
  assert.match(view, /label="输出"/);
  assert.match(view, /label="缓存命中"/);
  assert.match(view, /label="合计"/);
  assert.match(view, /tokenBreakdown/);
  assert.match(view, /creditDiscount/);
  assert.match(view, /kind: "折扣"/);
  assert.match(view, /creditBreakdown/);
  assert.match(view, /工作日 14:00–18:00（UTC\+8）为高峰/);
  assert.match(view, /其余时段按 50% 抵扣/);
  assert.doesNotMatch(view, /el-table-column label="Request ID"/);
  assert.match(view, /el-descriptions-item label="Request ID"/);
  assert.match(view, /下载全文/);
  assert.match(view, /placeholder="按人搜索"/);
  assert.doesNotMatch(view, /placeholder="全部企业"/);
  assert.doesNotMatch(view, /placeholder="全部部门"/);
  assert.doesNotMatch(view, /placeholder="全部员工"/);
});

test("ops audit employee labels use name and phone, not id-only placeholders", () => {
  assert.equal(
    formatOpsAuditTargetLabel(["海致科技", "管理员", "13800000000"], "员工 #1"),
    "海致科技 · 管理员 · 13800000000",
  );
  assert.equal(formatOpsAuditTargetLabel([null, "", undefined], "员工 #1（已删除）"), "员工 #1（已删除）");

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const route = readFileSync(resolve(root, "src/routes/admin/ops-audit.ts"), "utf8");
  assert.match(route, /employees\.name/);
  assert.match(route, /employees\.phone/);
  assert.doesNotMatch(route, /员工 #\$\{row\.id\}/);
});

test("log credits prefer the settled value and use the settlement interval", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const route = readFileSync(resolve(root, "src/routes/admin/logs.ts"), "utf8");
  const audit = readFileSync(resolve(root, "src/lib/relay/audit.ts"), "utf8");
  // 展示与结算同口径：按 [startedAt, createdAt] 区间加权，折扣可出现「跨高峰」
  assert.match(route, /const startedAt = row\.startedAt \?\? row\.createdAt;/);
  assert.match(route, /requestCreditDiscount\(startedAt, row\.createdAt\)/);
  // 优先读落库的结算值，旧行（无 started_at）回退为估算
  assert.match(route, /credits: settledCredits \?\? creditBreakdown\.total/);
  // 结算侧把 started_at / request_credits 写入审计行
  assert.match(audit, /startedAt,\n        requestCredits: requestCreditsText,/);
});
