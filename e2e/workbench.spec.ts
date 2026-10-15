import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { E2E } from "./env.ts";
import { isolateChannelPool } from "./pool-isolation.ts";
import {
  SCHED_LOGIN_PASSWORD,
  SCHED_PEOPLE,
  SCHED_POOLS,
  schedLineCode,
  type SchedPersonKey,
  type SchedPoolKey,
} from "./scheduling-fixture.ts";

/**
 * 超管工作台 E2E：首屏是「需要处理」的事，其次是渠道 Key 池和运行状态，
 * 日志存储空间保留整块，今日用量压成一行数字加趋势。
 *
 * 用例直接改库把几条调度夹具渠道摆成已知状态，再对比摆之前和摆之后的接口结果
 * （只看差值，别的用例留下的状态不影响结论），最后在页面上点一遍。
 *
 * 工作台可能出错的方式（每条对应下面的断言）：
 *  1. 被上游自动停用的 Key 没进待办，或者数量、原因（套餐到期 / 风控 / 鉴权失败）分错。
 *  2. 管理员手动停用的 Key 被算成「自动停用」催人处理。
 *  3. 冷却时间已过、库里状态还没翻回来的 Key 仍被算作冷却中。
 *  4. 套餐的 5 小时 / 周积分用到 80% 没提醒；只用了一半却提醒；没设上限的套餐被算出比例。
 *  5. 积分比例把停用的 Key 算进分母，池子明明快满了却显示还有一半。
 *  6. 上游已经回了「周上限用尽」而本地账本记得少，这把 Key 没按用满算。
 *  7. 启用的渠道一把能调度的 Key 都没有，却没有点名提醒；或者和原有的渠道统计对不上。
 *  8. 潮汐授权 3 天内到期没提醒；长期有效或还早的授权被误报。
 *  9. 今日敏感词检测 / 拦截次数与记录对不上。
 * 10. 席位数、已提交 KEY 数与库里对不上。
 * 11. 磁盘和上游失败的提醒与实际数字不一致（该提醒时没提醒，或反过来）。
 * 12. 企业管理员从同一个接口拿到了上游 Key 池和待办（越权）。
 * 13. 待办点过去不是对应的处理页面，或者没带上是哪条渠道。
 * 14. 没有待办时页面没有明确说「一切正常」。
 * 15. 日志存储空间那一块被挤掉了。
 * 16. 用量分析从有失败的多天区间切到「今天」后一直转圈（图表更新抛错，页面卡在加载中）。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type WindowLoad = { used: number; capacity: number; ratio: number; nextResetAt: string | null };

type PoolLine = {
  productLineId: number;
  name: string;
  total: number;
  active: number;
  cooling: number;
  autoDisabled: number;
  disabled: number;
  schedulable: number;
  fiveHour: WindowLoad | null;
  weekly: WindowLoad | null;
};

type Attention = {
  key: string;
  level: "danger" | "warn";
  title: string;
  detail: string;
  to: string | null;
};

type Overview = {
  channels: { unavailable: number };
  today: { requests: number };
  errorsByStatus: Array<{ key: string; requestCount: number }>;
  keyPool: {
    total: number;
    active: number;
    cooling: number;
    autoDisabled: number;
    disabled: number;
    autoDisabledByKind: { planExpired: number; fairUse: number; auth: number; other: number };
    lines: PoolLine[];
  };
  seats: { registered: number; submitted: number; capacity: number };
  tidal: {
    enabled: boolean;
    windowOpen: boolean;
    grants: { total: number; expired: number; expiringSoon: number };
  };
  sensitive: { detectToday: number; interceptToday: number };
  attention: Attention[];
};

type KeyRef = { pool: SchedPoolKey; label: string };

/** 这条用例会动到的渠道 Key；跑完按原样放回去。 */
const TOUCHED: KeyRef[] = [
  { pool: "quota", label: "qtao" },
  { pool: "quota", label: "qtaf" },
  { pool: "window5h", label: "w5ho" },
  { pool: "window5h", label: "w5hf" },
  { pool: "weekly", label: "wkyo" },
  { pool: "weekly", label: "wkyf" },
  { pool: "planExpired", label: "ex01" },
  { pool: "planExpired", label: "ex02" },
  { pool: "recharge", label: "rc01" },
  { pool: "overload", label: "ov01" },
  { pool: "overload", label: "ov02" },
];

const GRANT_PEOPLE: SchedPersonKey[] = ["guest3", "guest4", "ownerIdle"];
const HIT_PREFIX = "e2e-workbench-hit-";

type CredentialState = {
  id: string;
  status: string;
  cool_until: Date | null;
  last_failure_kind: string | null;
  last_vendor_code: string | null;
  five_hour_window_anchor: Date | null;
  five_hour_window_base_credits: string;
  weekly_window_reset_at: Date | null;
};

type BucketRow = {
  credential_id: string;
  hour_start: Date;
  total_tokens: string;
  total_credits: string;
  request_count: string;
};

type GrantRow = {
  employee_id: string;
  max_concurrency: number;
  rpm_limit: number;
  expires_at: Date | null;
  note: string | null;
  granted_by: string | null;
};

let api: APIRequestContext;
let sql: postgres.Sql;
let token = "";
let before: Overview;
let after: Overview;
let scenarioAt: Date;
let fiveHourAnchor: Date;
let weeklyResetAt: Date;

const lineIds = new Map<SchedPoolKey, number>();
const credentialIds = new Map<string, number>();
let savedCredentials: CredentialState[] = [];
let savedBuckets: BucketRow[] = [];
let savedGrants: GrantRow[] = [];
let savedTidalSettings: Record<string, unknown> | null = null;
let grantEmployeeIds: number[] = [];
let restorePool: (() => Promise<void>) | null = null;

function lineId(pool: SchedPoolKey): number {
  const id = lineIds.get(pool);
  if (id == null) throw new Error(`夹具缺少渠道 ${pool}`);
  return id;
}

function credentialId(pool: SchedPoolKey, label: string): number {
  const id = credentialIds.get(`${pool}/${label}`);
  if (id == null) throw new Error(`夹具缺少渠道 Key ${pool}/${label}`);
  return id;
}

function hourStartOf(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

/** 用例依赖「当前这个小时桶」，避开整点前后几秒。 */
async function waitOutHourBoundary(): Promise<void> {
  const msIntoHour = Date.now() % HOUR_MS;
  if (msIntoHour > HOUR_MS - 15_000) {
    await new Promise((done) => setTimeout(done, HOUR_MS - msIntoHour + 1_000));
  }
}

async function loginToken(phone: string, password: string): Promise<string> {
  const res = await api.post("/api/auth/login", { data: { phone, password } });
  const value = ((await res.json()) as { data?: { token?: string } }).data?.token;
  if (!value) throw new Error(`${phone} 登录失败`);
  return value;
}

async function overview(bearer = token): Promise<Overview> {
  const res = await api.get("/api/admin/overview", {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: Overview }).data;
}

async function setKey(
  ref: KeyRef,
  patch: {
    status?: "active" | "disabled" | "auto_disabled" | "cooling";
    coolUntil?: Date | null;
    failureKind?: string | null;
    fiveHourAnchor?: Date | null;
    weeklyResetAt?: Date | null;
    credits?: number;
  },
): Promise<void> {
  const id = credentialId(ref.pool, ref.label);
  await sql`
    update upstream_credentials
    set status = ${patch.status ?? "active"}::credential_status,
        cool_until = ${patch.coolUntil ?? null},
        last_failure_kind = ${patch.failureKind ?? null},
        last_vendor_code = null,
        five_hour_window_anchor = ${patch.fiveHourAnchor ?? null},
        five_hour_window_base_credits = 0,
        weekly_window_reset_at = ${patch.weeklyResetAt ?? null},
        updated_at = now()
    where id = ${id}
  `;
  await sql`delete from credential_usage_hourly where credential_id = ${id}`;
  if (patch.credits != null) {
    await sql`
      insert into credential_usage_hourly
        (credential_id, hour_start, total_tokens, total_credits, request_count)
      values (${id}, ${hourStartOf(scenarioAt)}, 1000, ${patch.credits}, 1)
    `;
  }
}

function lineOf(data: Overview, pool: SchedPoolKey): PoolLine {
  const line = data.keyPool.lines.find((row) => row.productLineId === lineId(pool));
  if (!line) throw new Error(`接口没有返回渠道 ${pool}`);
  return line;
}

function attentionOf(data: Overview, key: string): Attention | undefined {
  return data.attention.find((item) => item.key === key);
}

async function loginViaUi(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByText("账户登录", { exact: true }).click();
  await page.getByPlaceholder("11 位手机号").fill(E2E.admin.phone);
  await page.getByPlaceholder("请输入密码").fill(E2E.admin.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
}

test.describe.serial("超管工作台", () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: E2E.apiBaseUrl });
    sql = postgres(E2E.databaseUrl, { max: 1 });
    token = await loginToken(E2E.admin.phone, E2E.admin.password);

    const lines = await sql<Array<{ id: string; code: string }>>`
      select id, code from product_lines where code like 'cn_sched_%'
    `;
    for (const pool of Object.keys(SCHED_POOLS) as SchedPoolKey[]) {
      const row = lines.find((line) => line.code === schedLineCode(pool));
      if (row) lineIds.set(pool, Number(row.id));
    }
    // 夹具套餐默认停用（智谱是一个调度池）。工作台只看统计，把它们全部启用、同渠道其他套餐停用。
    restorePool = await isolateChannelPool(sql, "glm", [...lineIds.values()]);
    for (const ref of TOUCHED) {
      const [row] = await sql<Array<{ id: string }>>`
        select id from upstream_credentials
        where product_line_id = ${lineId(ref.pool)} and label = ${`调度-${ref.label}`}
      `;
      if (!row) throw new Error(`夹具缺少渠道 Key ${ref.pool}/${ref.label}`);
      credentialIds.set(`${ref.pool}/${ref.label}`, Number(row.id));
    }
    const ids = [...credentialIds.values()];

    savedCredentials = await sql<CredentialState[]>`
      select id, status, cool_until, last_failure_kind, last_vendor_code,
             five_hour_window_anchor, five_hour_window_base_credits, weekly_window_reset_at
      from upstream_credentials where id in ${sql(ids)}
    `;
    savedBuckets = await sql<BucketRow[]>`
      select credential_id, hour_start, total_tokens, total_credits, request_count
      from credential_usage_hourly where credential_id in ${sql(ids)}
    `;

    const people = await sql<Array<{ id: string; phone: string }>>`
      select id, phone from employees
      where phone in ${sql(GRANT_PEOPLE.map((key) => SCHED_PEOPLE[key].phone))}
    `;
    grantEmployeeIds = GRANT_PEOPLE.map((key) => {
      const row = people.find((item) => item.phone === SCHED_PEOPLE[key].phone);
      if (!row) throw new Error(`夹具缺少员工 ${key}`);
      return Number(row.id);
    });
    savedGrants = await sql<GrantRow[]>`
      select employee_id, max_concurrency, rpm_limit, expires_at, note, granted_by
      from tidal_grants where employee_id in ${sql(grantEmployeeIds)}
    `;
    await sql`delete from tidal_grants where employee_id in ${sql(grantEmployeeIds)}`;

    // 潮汐没开时授权到期不算待办，这里先打开，跑完放回原样。
    const headers = { Authorization: `Bearer ${token}` };
    const settingsRes = await api.get("/api/admin/tidal/settings", { headers });
    savedTidalSettings = ((await settingsRes.json()) as {
      data: { settings: Record<string, unknown> };
    }).data.settings;
    const enabled = await api.put("/api/admin/tidal/settings", {
      headers,
      data: { ...savedTidalSettings, enabled: true },
    });
    expect(enabled.status()).toBe(200);

    await waitOutHourBoundary();
    scenarioAt = new Date();

    // 基线：动到的 Key 全部健康、没有用量。
    for (const ref of TOUCHED) await setKey(ref, {});
    before = await overview();

    // 5 小时窗口从上一个整点开始，账本里的用量都记在当前这个小时。
    fiveHourAnchor = new Date(hourStartOf(scenarioAt).getTime() - HOUR_MS);
    weeklyResetAt = new Date(scenarioAt.getTime() - 3 * DAY_MS);
    const inOneHour = new Date(scenarioAt.getTime() + HOUR_MS);

    // 额度池（每把 Key 5 小时上限 100）：一把用到 90，另一把被管理员手动停用。
    await setKey({ pool: "quota", label: "qtao" }, { fiveHourAnchor, credits: 90 });
    await setKey({ pool: "quota", label: "qtaf" }, { status: "disabled" });
    // 五小时池（上限 100）：两把各用 50，合计一半，不该提醒。
    await setKey({ pool: "window5h", label: "w5ho" }, { credits: 50 });
    await setKey({ pool: "window5h", label: "w5hf" }, { credits: 50 });
    // 周窗口池（每把 Key 周上限 100）：一把用到 90；另一把账本只记了 10，
    // 但上游已经回了周上限用尽，正在冷却。
    await setKey({ pool: "weekly", label: "wkyo" }, { weeklyResetAt, credits: 90 });
    await setKey(
      { pool: "weekly", label: "wkyf" },
      { status: "cooling", coolUntil: inOneHour, failureKind: "weekly_cap", weeklyResetAt, credits: 10 },
    );
    // 到期池：两把 Key 都被上游停掉，整条渠道没有 Key 可用。
    await setKey({ pool: "planExpired", label: "ex01" }, { status: "auto_disabled", failureKind: "plan_expired" });
    await setKey({ pool: "planExpired", label: "ex02" }, { status: "auto_disabled", failureKind: "fair_use" });
    await setKey({ pool: "recharge", label: "rc01" }, { status: "auto_disabled", failureKind: "auth" });
    // 拥堵池：一把冷却已过期但状态没翻回来，一把还在冷却。
    await setKey(
      { pool: "overload", label: "ov01" },
      { status: "cooling", coolUntil: new Date(scenarioAt.getTime() - 60_000), failureKind: "rate_limit" },
    );
    await setKey(
      { pool: "overload", label: "ov02" },
      { status: "cooling", coolUntil: inOneHour, failureKind: "rate_limit" },
    );

    // 三个潮汐授权：明天到期、十天后到期、长期有效。
    const expiries = [
      new Date(scenarioAt.getTime() + DAY_MS),
      new Date(scenarioAt.getTime() + 10 * DAY_MS),
      null,
    ];
    for (const [index, employeeId] of grantEmployeeIds.entries()) {
      await sql`
        insert into tidal_grants (employee_id, max_concurrency, rpm_limit, expires_at, note)
        values (${employeeId}, 1, 10, ${expiries[index]}, 'e2e-workbench')
      `;
    }

    // 今天两次拦截、一次检测。
    for (const [index, action] of (["intercept", "intercept", "detect"] as const).entries()) {
      await sql`
        insert into sensitive_word_hits
          (request_id, employee_id, client_model, protocol, path, matched_word, action)
        values (${`${HIT_PREFIX}${index}`}, ${grantEmployeeIds[0]}, 'glm-5.3',
                'openai_chat', '/v1/chat/completions', 'e2e', ${action}::sensitive_word_hit_action)
        on conflict (request_id) do nothing
      `;
    }

    after = await overview();
  });

  test.afterAll(async () => {
    if (sql) {
      const ids = [...credentialIds.values()];
      if (ids.length) {
        await sql`delete from credential_usage_hourly where credential_id in ${sql(ids)}`;
        for (const row of savedBuckets) {
          await sql`
            insert into credential_usage_hourly
              (credential_id, hour_start, total_tokens, total_credits, request_count)
            values (${row.credential_id}, ${row.hour_start}, ${row.total_tokens},
                    ${row.total_credits}, ${row.request_count})
          `;
        }
        for (const row of savedCredentials) {
          await sql`
            update upstream_credentials
            set status = ${row.status}::credential_status,
                cool_until = ${row.cool_until},
                last_failure_kind = ${row.last_failure_kind},
                last_vendor_code = ${row.last_vendor_code},
                five_hour_window_anchor = ${row.five_hour_window_anchor},
                five_hour_window_base_credits = ${row.five_hour_window_base_credits},
                weekly_window_reset_at = ${row.weekly_window_reset_at}
            where id = ${row.id}
          `;
        }
      }
      if (grantEmployeeIds.length) {
        await sql`delete from tidal_grants where employee_id in ${sql(grantEmployeeIds)}`;
        for (const row of savedGrants) {
          await sql`
            insert into tidal_grants
              (employee_id, max_concurrency, rpm_limit, expires_at, note, granted_by)
            values (${row.employee_id}, ${row.max_concurrency}, ${row.rpm_limit},
                    ${row.expires_at}, ${row.note}, ${row.granted_by})
          `;
        }
      }
      await sql`delete from sensitive_word_hits where request_id like ${`${HIT_PREFIX}%`}`;
      await restorePool?.();
      await sql.end({ timeout: 5 });
    }
    if (api && savedTidalSettings) {
      await api.put("/api/admin/tidal/settings", {
        headers: { Authorization: `Bearer ${token}` },
        data: savedTidalSettings,
      });
    }
    await api?.dispose();
  });

  test("Key 池按真实状态计数：自动停用分原因，手动停用不催，过期的冷却不算", async () => {
    const pool = after.keyPool;
    const base = before.keyPool;
    expect(pool.total, "只改状态，不增减 Key").toBe(base.total);
    expect(pool.autoDisabled - base.autoDisabled).toBe(3);
    expect(pool.autoDisabledByKind.planExpired - base.autoDisabledByKind.planExpired).toBe(1);
    expect(pool.autoDisabledByKind.fairUse - base.autoDisabledByKind.fairUse).toBe(1);
    expect(pool.autoDisabledByKind.auth - base.autoDisabledByKind.auth).toBe(1);
    expect(pool.autoDisabledByKind.other - base.autoDisabledByKind.other).toBe(0);
    expect(pool.disabled - base.disabled, "手动停用单独计数").toBe(1);
    expect(pool.cooling - base.cooling, "冷却已过期的那把不算").toBe(2);
    expect(pool.active - base.active).toBe(-6);

    const overload = lineOf(after, "overload");
    expect(overload.cooling).toBe(1);
    expect(overload.schedulable, "冷却过期的 Key 可以调度").toBe(1);

    const item = attentionOf(after, "key-auto-disabled");
    expect(item, "有自动停用的 Key 就要进待办").toBeTruthy();
    expect(item!.level).toBe("danger");
    expect(item!.title).toBe(`${pool.autoDisabled} 把渠道 Key 被自动停用`);
    expect(item!.detail).toContain(`套餐到期 ${pool.autoDisabledByKind.planExpired}`);
    expect(item!.detail).toContain(`风控 ${pool.autoDisabledByKind.fairUse}`);
    expect(item!.detail).toContain(`鉴权失败 ${pool.autoDisabledByKind.auth}`);
    expect(item!.to).toMatch(/^\/admin\/keys-board/);
  });

  test("积分用量按能用的 Key 算：到线提醒，没到线和没设上限不提醒", async () => {
    const quota = lineOf(after, "quota");
    expect(quota.disabled).toBe(1);
    expect(quota.fiveHour, "停用的 Key 不进分母").toMatchObject({ used: 90, capacity: 100, ratio: 0.9 });
    expect(quota.fiveHour!.nextResetAt).toBe(
      new Date(fiveHourAnchor.getTime() + 5 * HOUR_MS).toISOString(),
    );
    expect(quota.weekly, "这条渠道没设周上限").toBeNull();

    const quotaItem = attentionOf(after, `credit-5h:${lineId("quota")}`);
    expect(quotaItem).toBeTruthy();
    expect(quotaItem!.level).toBe("warn");
    expect(quotaItem!.title).toBe(`「${SCHED_POOLS.quota.name}」5 小时积分已用 90%`);
    expect(quotaItem!.detail).toContain("重置");
    expect(quotaItem!.to).toBe(`/admin/keys-board?channelId=${lineId("quota")}`);

    const half = lineOf(after, "window5h");
    expect(half.fiveHour).toMatchObject({ used: 100, capacity: 200, ratio: 0.5, nextResetAt: null });
    expect(attentionOf(after, `credit-5h:${lineId("window5h")}`), "只用了一半不提醒").toBeUndefined();

    const weekly = lineOf(after, "weekly");
    expect(weekly.fiveHour, "这条渠道没设 5 小时上限").toBeNull();
    expect(weekly.weekly, "上游说周上限用尽的那把按用满算").toMatchObject({
      used: 190,
      capacity: 200,
      ratio: 0.95,
    });
    expect(weekly.weekly!.nextResetAt).toBe(new Date(weeklyResetAt.getTime() + 7 * DAY_MS).toISOString());
    const weeklyItem = attentionOf(after, `credit-weekly:${lineId("weekly")}`);
    expect(weeklyItem).toBeTruthy();
    expect(weeklyItem!.level, "95% 以上升为紧急").toBe("danger");
    expect(weeklyItem!.title).toBe(`「${SCHED_POOLS.weekly.name}」周积分已用 95%`);

    const unlimited = lineOf(after, "recharge");
    expect(unlimited.fiveHour).toBeNull();
    expect(unlimited.weekly).toBeNull();
  });

  test("没有 Key 可调度的启用渠道被点名，并与渠道统计一致", async () => {
    const expired = lineOf(after, "planExpired");
    expect(expired.schedulable).toBe(0);
    expect(lineOf(before, "planExpired").schedulable).toBe(2);

    const stuck = after.keyPool.lines.filter((line) => line.schedulable === 0);
    expect(stuck.length, "与原有的渠道统计是同一个数").toBe(after.channels.unavailable);
    expect(after.channels.unavailable - before.channels.unavailable).toBe(1);

    const item = attentionOf(after, "channel-unavailable");
    expect(item).toBeTruthy();
    expect(item!.level).toBe("danger");
    expect(item!.title).toBe(`${stuck.length} 条启用渠道没有可调度 Key`);
    expect(item!.detail).toContain(SCHED_POOLS.planExpired.name);
    expect(item!.detail, "还有 Key 能用的渠道不点名").not.toContain(SCHED_POOLS.overload.name);
  });

  test("潮汐授权、敏感词、席位的数字与库里一致", async () => {
    expect(after.tidal.enabled).toBe(true);
    expect(after.tidal.grants.total - before.tidal.grants.total).toBe(3);
    expect(after.tidal.grants.expiringSoon - before.tidal.grants.expiringSoon, "只有明天到期的算").toBe(1);
    expect(after.tidal.grants.expired - before.tidal.grants.expired).toBe(0);
    const grantItem = attentionOf(after, "tidal-grants");
    expect(grantItem).toBeTruthy();
    expect(grantItem!.title).toBe(`${after.tidal.grants.expiringSoon} 个潮汐授权 3 天内到期`);
    expect(grantItem!.to).toBe("/admin/tidal");

    expect(after.sensitive.interceptToday - before.sensitive.interceptToday).toBe(2);
    expect(after.sensitive.detectToday - before.sensitive.detectToday).toBe(1);

    const [seats] = await sql<Array<{ registered: number; submitted: number }>>`
      select count(*)::int as registered, count(credential_id)::int as submitted from channel_seats
    `;
    expect(after.seats.registered).toBe(seats.registered);
    expect(after.seats.submitted).toBe(seats.submitted);
  });

  test("磁盘和上游失败的提醒与实际数字一致", async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const storage = ((await (await api.get("/api/admin/storage", { headers })).json()) as {
      data: {
        disk: { totalBytes: number; usedBytes: number } | null;
        logs: { daysLeft: number | null } | null;
      };
    }).data;
    const usedRatio = storage.disk ? storage.disk.usedBytes / storage.disk.totalBytes : 0;
    const daysLeft = storage.logs?.daysLeft ?? null;
    const diskExpected = usedRatio >= 0.8 || (daysLeft != null && daysLeft <= 14);
    const fresh = await overview();
    expect(Boolean(attentionOf(fresh, "disk")), "磁盘到 80% 或两周内写满才提醒").toBe(diskExpected);

    const upstream =
      fresh.errorsByStatus.find((row) => row.key === "upstream_error")?.requestCount ?? 0;
    const errorsExpected =
      upstream >= 10 && fresh.today.requests > 0 && upstream / fresh.today.requests >= 0.05;
    expect(Boolean(attentionOf(fresh, "upstream-errors"))).toBe(errorsExpected);

    const levels = fresh.attention.map((item) => item.level);
    expect(levels, "紧急的排在前面").toEqual([...levels].sort((a, b) => (a === b ? 0 : a === "danger" ? -1 : 1)));
  });

  test("企业管理员拿不到上游 Key 池和待办", async () => {
    const orgToken = await loginToken(SCHED_PEOPLE.tdOrgAdmin.phone, SCHED_LOGIN_PASSWORD);
    const data = (await overview(orgToken)) as Partial<Overview>;
    expect(data.keyPool).toBeUndefined();
    expect(data.attention).toBeUndefined();
    expect(data.seats).toBeUndefined();
    expect(data.tidal).toBeUndefined();
    expect(data.sensitive).toBeUndefined();
  });

  test("页面：待办在最上面，点过去是对应渠道的 KEYS 看板；存储空间和今日用量都在", async ({ page }) => {
    await loginViaUi(page);

    const attention = page.getByTestId("attention");
    await expect(attention.getByText("需要处理")).toBeVisible();
    await expect(attention.getByText(`${after.keyPool.autoDisabled} 把渠道 Key 被自动停用`)).toBeVisible();
    await expect(attention.getByText(`「${SCHED_POOLS.quota.name}」5 小时积分已用 90%`)).toBeVisible();
    await expect(attention.getByText(`「${SCHED_POOLS.weekly.name}」周积分已用 95%`)).toBeVisible();
    await expect(attention.getByTestId("attention-item")).toHaveCount(after.attention.length);

    const pool = page.getByTestId("key-pool");
    await expect(pool.getByTestId("pool-active")).toHaveText(String(after.keyPool.active));
    await expect(pool.getByTestId("pool-cooling")).toHaveText(String(after.keyPool.cooling));
    await expect(pool.getByTestId("pool-auto-disabled")).toHaveText(String(after.keyPool.autoDisabled));
    await expect(pool.getByTestId("pool-disabled")).toHaveText(String(after.keyPool.disabled));

    const status = page.getByTestId("ops-status");
    await expect(status.getByText("席位")).toBeVisible();
    await expect(status.getByText("潮汐调度")).toBeVisible();
    await expect(status.getByText("敏感词")).toBeVisible();

    await expect(page.getByTestId("log-storage").getByText("日志存储空间")).toBeVisible();
    await expect(page.getByTestId("today-usage").getByText("今日 Tokens")).toBeVisible();
    await expect(page.getByText("组织消耗"), "排行已经交给用量分析页").toHaveCount(0);

    // 页面在内容区里滚动，把窗口拉高才能一张图截全。
    await page.setViewportSize({ width: 1440, height: 1900 });
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, "workbench.png") });

    await attention.getByText(`「${SCHED_POOLS.quota.name}」5 小时积分已用 90%`).click();
    await expect(page).toHaveURL(new RegExp(`/admin/keys-board\\?channelId=${lineId("quota")}$`));

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    const loadingMask = page.locator(".charts-page > .el-loading-mask");
    // 测试库里前几天没有调用。给多天区间的趋势补上失败数，
    // 这样切到没有失败的「今天」时，调用趋势图要从两条线变回一条。
    await page.route("**/api/admin/overview/analytics**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch();
      const body = (await response.json()) as {
        data: { trend: Array<{ requestCount: number; errorCount: number }> };
      };
      if (url.searchParams.get("from") !== url.searchParams.get("to")) {
        for (const row of body.data.trend) {
          row.requestCount += 20;
          row.errorCount += 3;
        }
      }
      await route.fulfill({ response, json: body });
    });

    await page.goto("/admin");
    await page.getByTestId("today-usage").getByRole("button", { name: "今日排行" }).click();
    await expect(page).toHaveURL(/\/admin\/usage\?range=today$/);
    await expect(page.getByText("组织消耗")).toBeVisible();
    await expect(loadingMask, "「今天」要能加载完，不能一直转圈").toBeHidden();
    await expect(page.getByText(/· 小时$/)).toBeVisible();

    // 在页面上来回切范围。
    await page.getByText("近 7 天", { exact: true }).click();
    await expect(page.getByText(/· 日$/)).toBeVisible();
    await expect(loadingMask).toBeHidden();
    await page.getByText("今天", { exact: true }).click();
    await expect(page.getByText(/· 小时$/)).toBeVisible();
    await expect(loadingMask, "从别的范围切到「今天」同样要加载完").toBeHidden();
    expect(pageErrors).toEqual([]);
  });

  test("页面：没有待办时明确显示一切正常", async ({ page }) => {
    // 测试库里总有别的用例留下的待办，这里只把接口结果里的待办清空，其余数据照旧。
    await page.route("**/api/admin/overview", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { data: Overview };
      body.data.attention = [];
      await route.fulfill({ response, json: body });
    });
    await loginViaUi(page);

    const attention = page.getByTestId("attention");
    await expect(attention.getByText("一切正常")).toBeVisible();
    await expect(attention.getByTestId("attention-item")).toHaveCount(0);
  });

  test("留档", async () => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const pick = (data: Overview) => ({
      keyPool: {
        ...data.keyPool,
        lines: (["quota", "window5h", "weekly", "planExpired", "recharge", "overload"] as const).map(
          (pool) => lineOf(data, pool),
        ),
      },
      seats: data.seats,
      tidal: data.tidal,
      sensitive: data.sensitive,
      attention: data.attention,
    });
    writeFileSync(
      resolve(ARTIFACT_DIR, "workbench.json"),
      `${JSON.stringify({ scenarioAt, before: pick(before), after: pick(after) }, null, 2)}\n`,
    );
  });
});
