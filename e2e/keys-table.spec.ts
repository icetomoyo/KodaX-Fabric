import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E } from "./env.ts";
import { SCHED_PEOPLE, SCHED_UI_PACKAGE } from "./scheduling-fixture.ts";

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
 *  8. 页面还显示已用 / 剩余积分：Token 套餐根本没有这两个数，只该显示使用率。
 *  9. 左侧渠道列出了充值渠道 DeepSeek（它没有额度窗口）。
 * 10. 火山方舟没有月额度列；或者月使用率不是按本地账本 ÷ 套餐月上限算的。
 * 11. 火山方舟上游回了月额度用尽（monthly_cap）时，月使用率不是 100%。
 * 12. 员工列显示当前挂着的借用者或 Key 备注，而不是 channel_seats 上的持有人。
 * 13. 没有持有人的充值 Key 显示成借用者或备注，而不是「无」。
 * 14. 按借用者姓名能搜到行，按持有人姓名搜不到。
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

    // 界面：只有使用率和重置时间，没有已用 / 剩余。按尾号搜出这两把 Key，逐格核对。
    const headers = (await page.locator(".el-table__header th").allInnerTexts()).map((text) => text.trim()).filter(Boolean);
    expect(headers).toEqual(["员工", "套餐", "KEY 尾号", "5 小时", "每周", "来源", "状态"]);
    await page.getByPlaceholder("搜索姓名").fill("uik");
    await expect(page.locator(".el-table__row")).toHaveCount(2);
    const rowText = async (suffix: string) =>
      (await page.locator(".el-table__row", { hasText: `•••• ${suffix}` }).innerText()).replace(/\s+/g, " ");
    await expect(page.locator(".el-table__row", { hasText: "•••• uik1" })).toContainText("36%");
    const creditRow = await rowText("uik1");
    const tokensRow = await rowText("uik2");
    expect(creditRow).toContain("54%");
    expect(creditRow).toContain("官方");
    expect(creditRow, "不再显示积分数").not.toContain("12,671");
    expect(tokensRow, "Token 套餐的周使用率要显示").toContain("82%");
    expect(tokensRow, "窗口还没开始：0%，重置时间为「—」").toMatch(/0% — 82%/);

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

test("渠道列表只有套餐渠道；火山方舟多一列月额度", async ({ page }) => {
  test.setTimeout(240_000);
  const sql = postgres(E2E.databaseUrl, { max: 1 });
  let lineId: number | null = null;
  try {
    await adminLogin(page);
    const token = await page.evaluate(() => localStorage.getItem("th_token"));
    const headers = { Authorization: `Bearer ${token}` };
    const created = await page.request.post("/api/admin/product-lines", {
      headers,
      data: {
        provider: "huoshan",
        productType: "coding_plan",
        name: "KEYS表格-方舟",
        tag: "keys-table",
        seatCount: 2,
        status: "active",
        supportedProtocols: ["openai_chat"],
      },
    });
    const createdBody = (await created.json()) as { data?: { id?: number } };
    expect(created.ok(), JSON.stringify(createdBody)).toBe(true);
    lineId = createdBody.data!.id!;
    const keyIds: number[] = [];
    for (const label of ["kt-local", "kt-capped"]) {
      const res = await page.request.post("/api/admin/credentials", {
        headers,
        data: { productLineId: lineId, label, secret: `sk-keys-table-${label}` },
      });
      const body = (await res.json()) as { data?: { id?: number } };
      expect(res.ok(), JSON.stringify(body)).toBe(true);
      keyIds.push(body.data!.id!);
    }
    // 套餐月上限 1000；本地账本本月用了 250（25%）。另一把上游回了月额度用尽。
    await sql`update product_lines set monthly_credit_limit = 1000 where id = ${lineId}`;
    const hourStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    await sql`
      insert into credential_usage_hourly (credential_id, hour_start, total_tokens, total_credits, request_count)
      values (${keyIds[0]}, ${hourStart}, 1000, 250, 1)
    `;
    await sql`
      update upstream_credentials
      set status = 'cooling', cool_until = ${new Date(Date.now() + 5 * 24 * 3_600_000)},
          last_failure_kind = 'monthly_cap', last_vendor_code = 'AccountQuotaExceeded'
      where id = ${keyIds[1]}
    `;

    await page.goto("/admin/keys-table");
    const channelNames = page.locator(".channel-item .channel-name");
    await expect(channelNames.first()).toBeVisible({ timeout: 15_000 });
    expect(await channelNames.allInnerTexts(), "充值渠道 DeepSeek 不列出").toEqual(["智谱", "火山方舟"]);

    await page.locator(".channel-item", { hasText: "火山方舟" }).click();
    const headerTexts = async () =>
      (await page.locator(".el-table__header th").allInnerTexts()).map((text) => text.trim()).filter(Boolean);
    await expect.poll(headerTexts).toEqual(["员工", "套餐", "KEY 尾号", "5 小时", "每周", "每月", "来源", "状态"]);
    await expect(page.locator(".keys-head .muted")).toContainText("本地账本估算");
    await expect(page.locator(".queried-at"), "方舟查不了官方额度，不显示查询时间").toHaveCount(0);

    await page.getByPlaceholder("搜索姓名").fill("kt-");
    await expect(page.locator(".el-table__row")).toHaveCount(2);
    const localRow = page.locator(".el-table__row", { hasText: "•••• ocal" });
    const cappedRow = page.locator(".el-table__row", { hasText: "•••• pped" });
    const monthlyCell = (row: typeof localRow) => row.locator("td").nth(5);
    await expect(monthlyCell(localRow), "月使用率 = 本地 250 ÷ 月上限 1000").toContainText("25%");
    await expect(localRow).toContainText("本地估算");
    await expect(monthlyCell(cappedRow), "上游回了月额度用尽").toContainText("100%");
    await expect(cappedRow).toContainText("上游已用尽");

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, "keys-table-huoshan.png"), fullPage: true });
    writeFileSync(
      resolve(ARTIFACT_DIR, "keys-table-huoshan.json"),
      `${JSON.stringify({
        channels: await channelNames.allInnerTexts(),
        columns: await headerTexts(),
        rows: {
          local: (await localRow.innerText()).replace(/\s+/g, " "),
          capped: (await cappedRow.innerText()).replace(/\s+/g, " "),
        },
      }, null, 2)}\n`,
    );
  } finally {
    if (lineId != null) {
      // 渠道池里不留这条测试套餐的可用 Key。
      await sql`update product_lines set status = 'disabled' where id = ${lineId}`;
      await sql`update upstream_credentials set status = 'disabled', cool_until = null where product_line_id = ${lineId}`;
    }
    await sql.end({ timeout: 5 });
  }
});

test("KEYS 表格员工列显示持有人，不显示当前挂着的借用者", async ({ page }) => {
  test.setTimeout(240_000);
  const sql = postgres(E2E.databaseUrl, { max: 1 });
  let lineId: number | null = null;
  try {
    await adminLogin(page);
    const token = await page.evaluate(() => localStorage.getItem("th_token"));
    const headers = { Authorization: `Bearer ${token}` };
    const created = await page.request.post("/api/admin/product-lines", {
      headers,
      data: {
        provider: "huoshan",
        productType: "coding_plan",
        name: "KEYS表格-持有人",
        tag: "keys-table-holder",
        seatCount: 1,
        status: "active",
        supportedProtocols: ["openai_chat"],
      },
    });
    const createdBody = (await created.json()) as { data?: { id?: number } };
    expect(created.ok(), JSON.stringify(createdBody)).toBe(true);
    lineId = createdBody.data!.id!;

    const [holder] = await sql<Array<{ id: string; enterprise_id: string }>>`
      select id, enterprise_id from employees where phone = ${SCHED_PEOPLE.ownerCap.phone}
    `;
    const [guest] = await sql<Array<{ id: string }>>`
      select id from employees where phone = ${SCHED_PEOPLE.guest1.phone}
    `;
    const [line] = await sql<Array<{ relay_pool_key: string }>>`
      select relay_pool_key from product_lines where id = ${lineId}
    `;
    expect(holder?.id, "调度夹具里要有容量持有人").toBeTruthy();
    expect(guest?.id, "调度夹具里要有借用甲").toBeTruthy();

    const holderKey = await page.request.post("/api/admin/credentials", {
      headers,
      data: {
        productLineId: lineId,
        label: "huoshan · 柯昆误标",
        secret: "sk-e2e-holder-aaaa",
      },
    });
    const holderBody = (await holderKey.json()) as { data?: { id?: number } };
    expect(holderKey.ok(), JSON.stringify(holderBody)).toBe(true);
    const holderCredentialId = holderBody.data!.id!;

    const rechargeKey = await page.request.post("/api/admin/credentials", {
      headers,
      data: {
        productLineId: lineId,
        label: "充值无持有人",
        secret: "sk-e2e-nohold-bbbb",
      },
    });
    const rechargeBody = (await rechargeKey.json()) as { data?: { id?: number } };
    expect(rechargeKey.ok(), JSON.stringify(rechargeBody)).toBe(true);

    const seat = await page.request.post("/api/admin/channel-seats", {
      headers,
      data: { employeeId: Number(holder.id), productLineId: lineId },
    });
    const seatBody = (await seat.json()) as { data?: { id?: number } };
    expect(seat.ok(), JSON.stringify(seatBody)).toBe(true);
    await sql`
      update channel_seats
      set credential_id = ${holderCredentialId}
      where id = ${seatBody.data!.id!}
    `;

    const [binding] = await sql<Array<{ id: string }>>`
      insert into credential_bindings (credential_id, product_line_id, relay_pool_key, scope_type, scope_id)
      values (${holderCredentialId}, ${lineId}, ${line.relay_pool_key}, 'enterprise', ${holder.enterprise_id})
      returning id
    `;
    await sql`
      insert into credential_binding_members (binding_id, employee_id, product_line_id, relay_pool_key, last_used_at)
      values (${binding.id}, ${guest.id}, ${lineId}, ${line.relay_pool_key}, now())
    `;

    await page.goto("/admin/keys-table");
    await page.locator(".channel-item", { hasText: "火山方舟" }).click();
    const holderRow = page.locator(".el-table__row", { hasText: "•••• aaaa" });
    const rechargeRow = page.locator(".el-table__row", { hasText: "•••• bbbb" });
    await expect(holderRow, "持有人那行要出现").toBeVisible({ timeout: 15_000 });
    await expect(holderRow.locator("td").first(), "员工列应是席位持有人").toHaveText(SCHED_PEOPLE.ownerCap.name);
    await expect(holderRow.locator("td").first(), "员工列不能是当前挂着的借用者").not.toContainText(SCHED_PEOPLE.guest1.name);
    await expect(holderRow.locator("td").first(), "员工列不能退回 Key 备注").not.toContainText("柯昆误标");
    await expect(rechargeRow.locator("td").first(), "充值 Key 没有持有人").toHaveText("无");

    await page.getByPlaceholder("搜索姓名").fill(SCHED_PEOPLE.ownerCap.name);
    await expect(page.locator(".el-table__row"), "按持有人姓名能搜到").toHaveCount(1);
    await expect(page.locator(".el-table__row")).toContainText("•••• aaaa");

    await page.getByPlaceholder("搜索姓名").fill(SCHED_PEOPLE.guest1.name);
    await expect(page.locator(".el-table__row"), "按借用者姓名搜不到").toHaveCount(0);

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.getByPlaceholder("搜索姓名").fill("");
    await page.screenshot({ path: resolve(ARTIFACT_DIR, "keys-table-holder.png"), fullPage: true });
    writeFileSync(
      resolve(ARTIFACT_DIR, "keys-table-holder.json"),
      `${JSON.stringify({
        holderCell: (await holderRow.locator("td").first().innerText()).trim(),
        rechargeCell: (await rechargeRow.locator("td").first().innerText()).trim(),
        holderName: SCHED_PEOPLE.ownerCap.name,
        guestName: SCHED_PEOPLE.guest1.name,
      }, null, 2)}\n`,
    );
  } finally {
    if (lineId != null) {
      await sql`update product_lines set status = 'disabled' where id = ${lineId}`;
      await sql`update upstream_credentials set status = 'disabled', cool_until = null where product_line_id = ${lineId}`;
    }
    await sql.end({ timeout: 5 });
  }
});

test("刷新官方额度后按官方校正 Key 冷却状态，看板上的位置随之准确", async ({ page }) => {
  test.setTimeout(240_000);
  /**
   * 可能出错的方式：
   *  a. 官方周额度已满，Key 还留在「等候」（下一个请求注定被上游拒绝）。
   *  b. 官方只有 5 小时满了，Key 进了「7 天冷却」，或者冷却时长不是官方的重置时刻。
   *  c. 周额度冷却已经过时（官方两个窗口都没满），Key 还被晾着。
   *  d. 解除冷却后周窗口相位还停在旧的 1310 时刻。
   *  e. 短时限流冷却被误解除。
   *  f. 停用的 Key 被改成冷却。
   */
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
  const now = Date.now();
  const HOUR = 3_600_000;
  const WEEKLY_FULL_RESET = now + 2 * 24 * HOUR;
  const FIVE_FULL_RESET = now + 90 * 60_000;
  const STALE_NEW_WEEKLY_RESET = now + 6 * 24 * HOUR;
  const tokensBody = (five: { percentage: number; reset?: number }, weekly: { percentage: number; reset?: number }) => ({
    code: 200,
    msg: "Operation successful",
    data: {
      limits: [
        { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: five.percentage, ...(five.reset ? { nextResetTime: five.reset } : {}) },
        { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: weekly.percentage, ...(weekly.reset ? { nextResetTime: weekly.reset } : {}) },
      ],
      level: "max",
    },
    success: true,
  });
  const cases = {
    rcw1: tokensBody({ percentage: 30, reset: now + HOUR }, { percentage: 100, reset: WEEKLY_FULL_RESET }),
    rcf1: tokensBody({ percentage: 100, reset: FIVE_FULL_RESET }, { percentage: 40, reset: now + 3 * 24 * HOUR }),
    rcs1: tokensBody({ percentage: 10, reset: now + 2 * HOUR }, { percentage: 5, reset: STALE_NEW_WEEKLY_RESET }),
    rcr1: tokensBody({ percentage: 20, reset: now + HOUR }, { percentage: 30, reset: now + 4 * 24 * HOUR }),
    rcd1: tokensBody({ percentage: 0 }, { percentage: 100, reset: WEEKLY_FULL_RESET }),
  } as const;
  type CaseLabel = keyof typeof cases;
  const ids = {} as Record<CaseLabel, number>;
  try {
    await adminLogin(page);
    const token = await page.evaluate(() => localStorage.getItem("th_token"));
    for (const label of Object.keys(cases) as CaseLabel[]) {
      const res = await page.request.post("/api/admin/credentials", {
        headers: { Authorization: `Bearer ${token}` },
        data: { productLineId: Number(line.id), label: `校正-${label}`, secret: `sk-reconcile-${label}` },
      });
      const body = (await res.json()) as { data?: { id?: number } };
      expect(res.ok(), JSON.stringify(body)).toBe(true);
      ids[label] = body.data!.id!;
      await mockQuota(`sk-reconcile-${label}`, cases[label]);
    }
    await sql`
      update product_lines
      set zhipu_organization_id = 'org-e2e', zhipu_project_id = 'proj_e2e', official_quota_query_enabled = true
      where id = ${line.id}
    `;
    // 过时的周额度冷却：本地还记着更早一次 1310 说的恢复时刻。
    const staleUntil = new Date(now + 3 * 24 * HOUR);
    await sql`
      update upstream_credentials
      set status = 'cooling', cool_until = ${staleUntil}, last_failure_kind = 'weekly_cap',
          last_vendor_code = '1310', weekly_window_reset_at = ${staleUntil}
      where id = ${ids.rcs1}
    `;
    await sql`
      update upstream_credentials
      set status = 'cooling', cool_until = ${new Date(now + 4 * 60_000)}, last_failure_kind = 'rate_limit'
      where id = ${ids.rcr1}
    `;
    await sql`update upstream_credentials set status = 'disabled' where id = ${ids.rcd1}`;

    await page.goto("/admin/keys-table");
    await expect(page.getByRole("button", { name: "刷新" })).toBeEnabled({ timeout: 15_000 });
    const body = await refreshQuota(page) as unknown as { reconciled?: { cooled: number; released: number } };
    expect(body.reconciled, "两把满额的转冷却，一把过时冷却解除").toEqual({ cooled: 2, released: 1 });
    await expect(page.locator(".el-message--success")).toContainText("已按官方额度校正 Key 状态");

    const state = async (label: CaseLabel) => {
      const [row] = await sql<Array<{
        status: string;
        cool_until: Date | null;
        last_failure_kind: string | null;
        weekly_window_reset_at: Date | null;
      }>>`
        select status, cool_until, last_failure_kind, weekly_window_reset_at
        from upstream_credentials where id = ${ids[label]}
      `;
      return row;
    };
    const weeklyFull = await state("rcw1");
    expect(weeklyFull.status).toBe("cooling");
    expect(weeklyFull.last_failure_kind).toBe("weekly_cap");
    expect(Math.abs(weeklyFull.cool_until!.getTime() - WEEKLY_FULL_RESET), "冷却到官方周重置时刻").toBeLessThan(1_000);

    const fiveFull = await state("rcf1");
    expect(fiveFull.last_failure_kind).toBe("five_hour_cap");
    expect(Math.abs(fiveFull.cool_until!.getTime() - FIVE_FULL_RESET), "冷却到官方 5 小时重置时刻").toBeLessThan(1_000);

    const stale = await state("rcs1");
    expect(stale.status, "过时的周额度冷却解除").toBe("active");
    expect(stale.cool_until).toBeNull();
    expect(stale.last_failure_kind).toBeNull();
    expect(Math.abs(stale.weekly_window_reset_at!.getTime() - STALE_NEW_WEEKLY_RESET), "周相位改用官方的").toBeLessThan(1_000);

    const rateLimited = await state("rcr1");
    expect(rateLimited.status, "短时限流冷却不动").toBe("cooling");
    expect(rateLimited.last_failure_kind).toBe("rate_limit");

    expect((await state("rcd1")).status, "停用的 Key 不动").toBe("disabled");

    // 看板：每把 Key 在对应的列里。
    await page.goto("/admin/keys-board");
    const laneOf = async (label: CaseLabel) => {
      const ring = page.locator(`.key-ring[title*="•••• ${label}"]`);
      await expect(ring).toBeVisible({ timeout: 15_000 });
      return (await ring
        .locator("xpath=ancestor::div[contains(@class,'kanban-column')]")
        .locator(".kanban-column-title")
        .first()
        .innerText()).trim();
    };
    const lanes = {
      rcw1: await laneOf("rcw1"),
      rcf1: await laneOf("rcf1"),
      rcs1: await laneOf("rcs1"),
      rcr1: await laneOf("rcr1"),
      rcd1: await laneOf("rcd1"),
    };
    expect(lanes).toEqual({
      rcw1: "7 天冷却",
      rcf1: "5 小时冷却",
      rcs1: "等候",
      rcr1: "限流",
      rcd1: "停用",
    });

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, "keys-board-reconciled.png"), fullPage: true });
    writeFileSync(
      resolve(ARTIFACT_DIR, "keys-reconcile.json"),
      `${JSON.stringify({ reconciled: body.reconciled, lanes }, null, 2)}\n`,
    );
  } finally {
    const created = Object.values(ids);
    if (created.length) await sql`delete from upstream_credentials where id in ${sql(created)}`;
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
