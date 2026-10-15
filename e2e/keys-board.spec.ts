import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator } from "@playwright/test";
import postgres from "postgres";
import { E2E } from "./env.ts";
import { SCHED_UI_PACKAGE } from "./scheduling-fixture.ts";

/**
 * 超管「Key 看板」的圆环：外圈是周额度，内圈是 5 小时额度。
 *
 * 可能出错的方式：
 *  1. 上游已经回了周额度用尽（1310，Key 因 weekly_cap 冷却），本地账本记得少
 *     （Token 套餐按 Token 计额度，或 Key 在平台外被用过），外圈只画了本地估算的一小段。
 *  2. 中间的百分比、悬停提示、详情抽屉里的进度条和外圈说的不是同一个数。
 *  3. 没有上游用尽信号的 Key 被误画满（规则扩散到了正常 Key）。
 *  4. 周额度用尽时把内圈（5 小时）也画满了。
 *  5. 已经在 KEYS 表格刷新过官方额度，看板还按本地账本画（Token 套餐的本地积分账本
 *     对不上真实用量，积分套餐的 Key 也可能在平台外被用过）。
 *  6. 官方快照的窗口已经翻页（重置时刻已过），旧百分比还被拿来画圈。
 *  7. 积分套餐和 Token 套餐按两套规则取数：两者官方都给百分比，应当一视同仁。
 *  8. 圈按官方画了，重置时刻还是本地估算的，两者对不上。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");
const WEEKLY_LIMIT = 1000;
const LOCAL_WEEKLY_CREDITS = 100;
const HOUR_MS = 3_600_000;

function ringFill(dasharray: string | null): number {
  const [filled, circumference] = (dasharray ?? "").split(/\s+/).map(Number);
  return filled / circumference;
}

async function ringState(ring: Locator) {
  return {
    outer: ringFill(await ring.locator(".key-ring-progress.outer").getAttribute("stroke-dasharray")),
    inner: ringFill(await ring.locator(".key-ring-progress.inner").getAttribute("stroke-dasharray")),
    caption: (await ring.locator(".key-ring-pct").innerText()).trim(),
    title: (await ring.getAttribute("title")) ?? "",
  };
}

test("看板圆环：上游用尽画满，官方快照优先于本地账本", async ({ page }) => {
  test.setTimeout(120_000);
  const sql = postgres(E2E.databaseUrl, { max: 1 });
  const [line] = await sql<Array<{ id: string; five_hour_credit_limit: string | null; weekly_credit_limit: string | null }>>`
    select id, five_hour_credit_limit, weekly_credit_limit from product_lines where code = ${SCHED_UI_PACKAGE.code}
  `;
  expect(line, "seed-scheduling 应写入界面用的智谱套餐").toBeTruthy();
  const keys = await sql<Array<{
    id: string;
    label: string;
    status: string;
    cool_until: Date | null;
    last_failure_kind: string | null;
    last_vendor_code: string | null;
  }>>`
    select id, label, status, cool_until, last_failure_kind, last_vendor_code
    from upstream_credentials where product_line_id = ${line.id}
  `;
  const keyId = (label: string) => Number(keys.find((row) => row.label === `调度-${label}`)!.id);
  const capped = keyId("uik1");
  const healthy = keyId("uik2");
  const hourStart = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);

  try {
    await sql`
      update product_lines set weekly_credit_limit = ${WEEKLY_LIMIT}, five_hour_credit_limit = null
      where id = ${line.id}
    `;
    for (const id of [capped, healthy]) {
      await sql`
        insert into credential_usage_hourly (credential_id, hour_start, total_tokens, total_credits, request_count)
        values (${id}, ${hourStart}, 1000, ${LOCAL_WEEKLY_CREDITS}, 1)
        on conflict (credential_id, hour_start) do update set total_credits = excluded.total_credits
      `;
    }
    await sql`
      update upstream_credentials
      set status = 'cooling', cool_until = ${new Date(Date.now() + 2 * 24 * HOUR_MS)},
          last_failure_kind = 'weekly_cap', last_vendor_code = '1310'
      where id = ${capped}
    `;
    await sql`
      update upstream_credentials
      set status = 'active', cool_until = null, last_failure_kind = null, last_vendor_code = null
      where id = ${healthy}
    `;

    await page.goto("/");
    await page.getByText("账户登录", { exact: true }).click();
    await page.getByPlaceholder("11 位手机号").fill(E2E.admin.phone);
    await page.getByPlaceholder("请输入密码").fill(E2E.admin.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
    await page.goto("/admin/keys-board");

    const cappedRing = page.locator(".key-ring", { has: page.locator("svg") }).and(
      page.locator('[title*="•••• uik1"]'),
    );
    const healthyRing = page.locator('.key-ring[title*="•••• uik2"]');
    await expect(cappedRing).toBeVisible({ timeout: 15_000 });
    await expect(healthyRing).toBeVisible();

    const cappedState = await ringState(cappedRing);
    const healthyState = await ringState(healthyRing);

    expect(cappedState.outer, "上游说周额度用尽：外圈要画满").toBeCloseTo(1, 3);
    expect(cappedState.caption).toBe("100%");
    expect(cappedState.title, "悬停提示要说明是上游用尽").toContain("上游已用尽");
    expect(cappedState.inner, "周额度用尽不影响 5 小时内圈").toBeCloseTo(0, 3);

    expect(healthyState.outer, "没有上游信号的 Key 照本地账本画").toBeCloseTo(
      LOCAL_WEEKLY_CREDITS / WEEKLY_LIMIT,
      3,
    );
    expect(healthyState.caption).toBe(`${Math.round((LOCAL_WEEKLY_CREDITS / WEEKLY_LIMIT) * 100)}%`);

    // 详情抽屉：本周进度条与外圈一致。
    await cappedRing.click();
    const drawer = page.locator(".el-drawer", { hasText: "Key 详情" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("（上游已用尽）")).toBeVisible();
    const weeklyBar = drawer.locator(".quota-progress", { hasText: "本周" });
    await expect(weeklyBar.locator('[role="progressbar"]')).toHaveAttribute("aria-valuenow", "100");
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, "keys-board-weekly-cap.png"), fullPage: true });

    // 官方快照：uik2 本地账本仍是 10%，换不同的快照看圈怎么画。
    const setSnapshot = async (weekly: unknown) => {
      await sql`
        update upstream_credentials
        set official_quota = ${sql.json({ state: "ok", level: "max", fiveHour: null, weekly } as never)},
            official_quota_at = ${new Date()}
        where id = ${healthy}
      `;
      await page.reload();
      await expect(healthyRing).toBeVisible({ timeout: 15_000 });
      return ringState(healthyRing);
    };
    const future = new Date(Date.now() + 3 * 24 * HOUR_MS).toISOString();
    const past = new Date(Date.now() - HOUR_MS).toISOString();

    const tokensPlan = await setSnapshot({ used: null, limit: null, remaining: null, percentage: 82, resetAt: future });
    expect(tokensPlan.outer, "Token 套餐按官方百分比画，不看本地积分").toBeCloseTo(0.82, 3);
    expect(tokensPlan.caption).toBe("82%");
    expect(tokensPlan.title).toContain("官方 82%");
    expect(tokensPlan.title, "重置时刻用官方给的，不再是本地估算").not.toContain("（估算）");

    const tokensPlanLow = await setSnapshot({ used: null, limit: null, remaining: null, percentage: 3, resetAt: future });
    expect(tokensPlanLow.outer, "Token 套餐官方比本地低也以官方为准").toBeCloseTo(0.03, 3);

    const stale = await setSnapshot({ used: null, limit: null, remaining: null, percentage: 82, resetAt: past });
    expect(stale.outer, "窗口已翻页的旧快照不算数，回到本地账本").toBeCloseTo(0.1, 3);
    expect(stale.title).not.toContain("官方");
    expect(stale.title, "旧快照不算数时回到本地估算的重置时刻").toContain("（估算）");

    const creditLow = await setSnapshot({ used: 50, limit: WEEKLY_LIMIT, remaining: 950, percentage: 5, resetAt: future });
    expect(creditLow.outer, "积分套餐同样按官方百分比，官方比本地低也以官方为准").toBeCloseTo(0.05, 3);

    const creditHigh = await setSnapshot({ used: 600, limit: WEEKLY_LIMIT, remaining: 400, percentage: 60, resetAt: future });
    expect(creditHigh.outer, "积分套餐官方比本地高：按官方").toBeCloseTo(0.6, 3);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, "keys-board-official-snapshot.png"), fullPage: true });

    writeFileSync(
      resolve(ARTIFACT_DIR, "keys-board-rings.json"),
      `${JSON.stringify({
        upstreamWeeklyCap: cappedState,
        localOnly: healthyState,
        officialSnapshot: { tokensPlan, tokensPlanLow, stale, creditLow, creditHigh },
      }, null, 2)}\n`,
    );
  } finally {
    await sql`
      update product_lines
      set weekly_credit_limit = ${line.weekly_credit_limit}, five_hour_credit_limit = ${line.five_hour_credit_limit}
      where id = ${line.id}
    `;
    for (const row of keys) {
      await sql`
        update upstream_credentials
        set status = ${row.status}::credential_status, cool_until = ${row.cool_until},
            last_failure_kind = ${row.last_failure_kind}, last_vendor_code = ${row.last_vendor_code},
            official_quota = null, official_quota_at = null
        where id = ${row.id}
      `;
    }
    await sql`delete from credential_usage_hourly where credential_id in ${sql([capped, healthy])} and hour_start = ${hourStart}`;
    await sql.end({ timeout: 5 });
  }
});
