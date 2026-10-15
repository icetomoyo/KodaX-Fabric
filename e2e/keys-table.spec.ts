import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E } from "./env.ts";
import { SCHED_UI_PACKAGE } from "./scheduling-fixture.ts";

/**
 * 超管「KEYS 表格」点「刷新」查官方额度。
 *
 * 可能出错的方式：
 *  1. 刷新请求的 Content-Type 不是 JSON（axios 对 null 体会发 x-www-form-urlencoded），
 *     Fastify 在鉴权之前就回 415，页面弹「Unsupported Media Type」。
 *  2. 刷新返回非 200，或者页面弹出错误提示。
 *  3. 刷新后表格没有带回查询时间。
 *  4. Token 套餐（智谱只回 TOKENS_LIMIT，只有百分比）被整条丢掉：状态是「正常」，
 *     5 小时 / 周的使用率和重置时间却都是空的。
 *  5. 改完后积分套餐（CREDIT_LIMIT，有已用 / 剩余）反而显示不出数字。
 *  6. TIME_LIMIT（联网搜索等工具的调用次数，也有 unit=3）被当成 5 小时窗口。
 *  7. 窗口还没开始、没有 nextResetTime 时报错，而不是显示「—」。
 *  8. 不知道的已用量显示成 0，而不是「—」。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");

/** 以下报文照搬 2026-10-15 智谱对三种团队套餐 Key 的真实返回。 */
const NOW = Date.now();
const FIVE_HOUR_RESET = NOW + 2 * 3_600_000;
const WEEKLY_RESET = NOW + 3 * 24 * 3_600_000;

/** GLM-50 这类积分套餐：CREDIT_LIMIT 带已用 / 上限 / 剩余。 */
const CREDIT_PLAN_BODY = {
  code: 200,
  msg: "Operation successful",
  data: {
    limits: [
      { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 35000, currentValue: 12671, remaining: 22328, percentage: 36, nextResetTime: FIVE_HOUR_RESET },
      { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 155000, currentValue: 83907, remaining: 71092, percentage: 54, nextResetTime: WEEKLY_RESET },
    ],
    level: "max",
  },
  success: true,
};

/** GLM-10 / GLM-30 这类 Token 套餐：只有百分比；TIME_LIMIT 也带 unit=3；5 小时窗口还没开始。 */
const TOKENS_PLAN_BODY = {
  code: 200,
  msg: "Operation successful",
  data: {
    limits: [
      { type: "TIME_LIMIT", unit: 3, number: 1, usage: 4000, currentValue: 0, remaining: 4000, percentage: 99 },
      { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 0 },
      { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 82, nextResetTime: WEEKLY_RESET },
    ],
    level: "max",
  },
  success: true,
};

async function adminLogin(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByText("账户登录", { exact: true }).click();
  await page.getByPlaceholder("11 位手机号").fill(E2E.admin.phone);
  await page.getByPlaceholder("请输入密码").fill(E2E.admin.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
}

async function mockQuota(secret: string, body: unknown): Promise<void> {
  const res = await fetch(`${E2E.mockUpstreamBaseUrl}/__control/quota`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret, body }),
  });
  expect(res.ok).toBe(true);
}

async function refreshQuota(page: Page) {
  const responsePromise = page.waitForResponse(
    (res) => res.url().includes("/official-quota/refresh"),
    { timeout: 200_000 },
  );
  await page.getByRole("button", { name: "刷新" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    data: Array<{
      credentialId: number;
      state: string;
      fiveHour?: { used: number | null; remaining: number | null; percentage: number; resetAt: string | null } | null;
      weekly?: { used: number | null; remaining: number | null; percentage: number; resetAt: string | null } | null;
    }>;
  };
}

test("KEYS 表格点刷新：以 JSON 请求官方额度，返回 200 且不报错", async ({ page }) => {
  test.setTimeout(240_000);
  await adminLogin(page);

  await page.goto("/admin/keys-table");
  const refresh = page.getByRole("button", { name: "刷新" });
  await expect(refresh).toBeEnabled({ timeout: 15_000 });

  const requestPromise = page.waitForRequest((req) => req.url().includes("/official-quota/refresh"));
  const responsePromise = page.waitForResponse(
    (res) => res.url().includes("/official-quota/refresh"),
    { timeout: 200_000 },
  );
  await refresh.click();
  const request = await requestPromise;
  const response = await responsePromise;
  const body = (await response.json()) as { data?: unknown[]; queriedAt?: string | null };

  expect(request.headers()["content-type"], "刷新请求应带 JSON 体").toContain("application/json");
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(typeof body.queriedAt, "刷新后应带回查询时间").toBe("string");
  await expect(refresh).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator(".el-message--error")).toHaveCount(0);

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(ARTIFACT_DIR, "keys-table-refresh.png"), fullPage: true });
  writeFileSync(
    resolve(ARTIFACT_DIR, "keys-table-refresh.json"),
    `${JSON.stringify({
      contentType: request.headers()["content-type"],
      status: response.status(),
      queriedAt: body.queriedAt,
      items: Array.isArray(body.data) ? body.data.length : 0,
    }, null, 2)}\n`,
  );
});

test("积分套餐和 Token 套餐刷新后都显示 5 小时 / 周额度", async ({ page }) => {
  test.setTimeout(240_000);
  const sql = postgres(E2E.databaseUrl, { max: 1 });
  const [line] = await sql<Array<{
    id: string;
    zhipu_organization_id: string | null;
    zhipu_project_id: string | null;
    official_quota_query_enabled: boolean;
  }>>`
    select id, zhipu_organization_id, zhipu_project_id, official_quota_query_enabled
    from product_lines where code = ${SCHED_UI_PACKAGE.code}
  `;
  expect(line, "seed-scheduling 应写入界面用的智谱套餐").toBeTruthy();
  const ids = await sql<Array<{ id: string; label: string }>>`
    select id, label from upstream_credentials where product_line_id = ${line.id}
  `;
  const credentialId = (label: string) => Number(ids.find((row) => row.label === `调度-${label}`)!.id);
  try {
    await sql`
      update product_lines
      set zhipu_organization_id = 'org-e2e', zhipu_project_id = 'proj_e2e', official_quota_query_enabled = true
      where id = ${line.id}
    `;
    await mockQuota("sk-sched-ui-uik1", CREDIT_PLAN_BODY);
    await mockQuota("sk-sched-ui-uik2", TOKENS_PLAN_BODY);

    await adminLogin(page);
    await page.goto("/admin/keys-table");
    await expect(page.getByRole("button", { name: "刷新" })).toBeEnabled({ timeout: 15_000 });
    const body = await refreshQuota(page);
    const credit = body.data.find((item) => item.credentialId === credentialId("uik1"));
    const tokens = body.data.find((item) => item.credentialId === credentialId("uik2"));

    expect(credit?.state).toBe("ok");
    expect(credit?.fiveHour, "积分套餐带具体积分").toMatchObject({
      used: 12671,
      remaining: 22328,
      percentage: 36,
      resetAt: new Date(FIVE_HOUR_RESET).toISOString(),
    });
    expect(credit?.weekly).toMatchObject({ used: 83907, percentage: 54 });

    expect(tokens?.state).toBe("ok");
    expect(tokens?.fiveHour, "Token 套餐的 5 小时取 TOKENS_LIMIT，不是 TIME_LIMIT").toEqual({
      used: null,
      limit: null,
      remaining: null,
      percentage: 0,
      resetAt: null,
    });
    expect(tokens?.weekly, "Token 套餐只有百分比和重置时间").toMatchObject({
      used: null,
      remaining: null,
      percentage: 82,
      resetAt: new Date(WEEKLY_RESET).toISOString(),
    });

    // 界面：按标签搜出这两把 Key，逐格核对。
    await page.getByPlaceholder("搜索姓名").fill("uik");
    const rowText = async (label: string) =>
      (await page.locator(".el-table__row", { hasText: label }).innerText()).replace(/\s+/g, " ");
    await expect(page.locator(".el-table__row")).toHaveCount(2);
    const creditRow = await rowText("调度-uik1");
    const tokensRow = await rowText("调度-uik2");
    expect(creditRow).toContain("12,671");
    expect(creditRow).toContain("36%");
    expect(creditRow).toContain("54%");
    expect(tokensRow, "Token 套餐的周使用率要显示").toContain("82%");
    expect(tokensRow, "不知道的已用量不能显示成 0").not.toMatch(/(^| )0( |$)/);
    expect(tokensRow).toContain("—");

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, "keys-table-plan-types.png"), fullPage: true });
    writeFileSync(
      resolve(ARTIFACT_DIR, "keys-table-plan-types.json"),
      `${JSON.stringify({ creditPlan: credit, tokensPlan: tokens, rows: { creditRow, tokensRow } }, null, 2)}\n`,
    );
  } finally {
    await sql`
      update product_lines
      set zhipu_organization_id = ${line.zhipu_organization_id},
          zhipu_project_id = ${line.zhipu_project_id},
          official_quota_query_enabled = ${line.official_quota_query_enabled}
      where id = ${line.id}
    `;
    await sql`update upstream_credentials set official_quota = null, official_quota_at = null where product_line_id = ${line.id}`;
    await fetch(`${E2E.mockUpstreamBaseUrl}/__control/reset`, { method: "POST" });
    await sql.end({ timeout: 5 });
  }
});
