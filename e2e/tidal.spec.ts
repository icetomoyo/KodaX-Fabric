import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { E2E } from "./env.ts";
import {
  SCHED_LOGIN_PASSWORD,
  SCHED_PEOPLE,
  schedApiKey,
  schedSecret,
  type SchedPersonKey,
} from "./scheduling-fixture.ts";

/**
 * 潮汐调度 E2E：被授权的员工用一把「潮汐KEY」，在开放时段内把请求铺到很多把
 * 闲置的渠道 Key 上（每把只占一两个并发），不挤占席位主人。
 *
 * 全程走真实 HTTP 进真实 server，上游是本机可编排的 mock。夹具见
 * scheduling-fixture.ts 的 tidal 池：8 把席位 Key，套餐上限 5 小时 100 / 每周 1000。
 * 用例往账本里写用量，把它们分成：
 *   td01 td02 td07 td08  周用量 ≈ 0      → 第一档
 *   td03                  周用量 10%      → 第二档
 *   td04                  周用量 60%      → 超过周借用线（50%）
 *   td05                  5 小时用量 70%  → 超过 5 小时借用线（60%）
 *   td06                  主人是别的企业的员工
 *
 * 潮汐调度可能出错的方式（每条对应下面一个断言）：
 *  1. 没授权的员工能看到潮汐相关字段，或者能建出潮汐KEY。
 *  2. 企业管理员（非超级管理员）能读写潮汐调度的设置和授权。
 *  3. 授权后员工看不到授权信息、建不出潮汐KEY；或者一个人能建出第二把。
 *  4. 授权、改额度、撤销没有留下运维审计。
 *  5. 开放时段之外请求仍被放行；或者只回了笼统的 429，看不出是时段问题。
 *  6. 总开关关掉后潮汐KEY 仍然可用。
 *  7. 潮汐请求挤在少数几把 Key 上：一把 Key 上的潮汐在途超过配置的上限（2）。
 *  8. 第一档还有空位时用了第二档的 Key（没有优先用周用量最低的）。
 *  9. 周用量超过借用线的 Key 被潮汐用了。
 * 10. 5 小时用量超过借用线的 Key 被潮汐用了。
 * 11. 别的企业员工名下的 Key 被潮汐用了。
 * 12. 授权 8 并发，却被员工级 5 并发的保护限流提前拦住；或者超过 8 仍放行。
 * 13. 潮汐请求加入了 Key 的成员关系（占了 3 人名额、留下绑定）。
 * 14. 能用的 Key 都没有潮汐空位时请求挂住或报 5xx，而不是立刻 429 带 retry-after。
 * 15. 主人回来时因为 Key 上有潮汐在途而用不上自己的 Key。
 * 16. Key 上已经有成员在用，潮汐的新请求还往上发。
 * 17. 同一个会话的请求没有粘在同一把 Key 上；或者两个会话被排到同一把 Key（没铺开）。
 * 18. 会话粘着的 Key 不能用了，会话没有换到别的 Key。
 * 19. 潮汐请求没有和普通请求一样计入员工、部门的用量统计；或者请求日志里认不出哪些是潮汐请求。
 * 20. 潮汐请求的消耗没有记到渠道 Key 的账本上（主人看到的剩余额度就是错的）。
 * 21. 授权到期后潮汐KEY 仍可用，或者仍出现在员工的列表里。
 * 22. 撤销授权后潮汐KEY 仍可用，或者没有被删除。
 * 23. 管理端没有「潮汐调度」页，或者被授权的人没显示在名单里。
 * 24. 被授权员工的页面上没有潮汐KEY；没授权员工的页面上出现了潮汐KEY。
 * 25. 管理端「新增授权」对话框里按姓名或手机号搜不到员工，没法在界面上完成授权。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");
const MODEL = "e2e-upstream-model";
const POOL = "tidal";
const HOUR_MS = 3_600_000;

type CallResult = {
  marker: string;
  status: number;
  key: string | null;
  code: string | null;
  message: string | null;
  retryAfter: string | null;
};

type MockState = {
  hits: Array<{ seq: number; secret: string; model: string; marker: string | null }>;
  inFlight: Record<string, number>;
  maxInFlight: Record<string, number>;
};

type Behavior = { type: "ok" } | { type: "hold" };

type TidalSettings = {
  enabled: boolean;
  windowStart: string;
  windowEnd: string;
  weeklyTiers: number[];
  weeklyLine: number;
  fiveHourLine: number;
  perKeyConcurrency: number;
};

let api: APIRequestContext;
let sql: postgres.Sql;
let markerSeq = 0;
let tidalLineId = 0;
let tidalKey = "";
let grantId = 0;
let timezone = "Asia/Shanghai";
const report: Record<string, unknown> = {};
const tokens = new Map<string, string>();
const employeeIds = new Map<SchedPersonKey, number>();

const ALL_LABELS = ["td01", "td02", "td03", "td04", "td05", "td06", "td07", "td08"] as const;
const FIRST_TIER = ["td01", "td02", "td07", "td08"];

function employeeId(person: SchedPersonKey): number {
  const id = employeeIds.get(person);
  if (id == null) throw new Error(`夹具缺少员工 ${person}`);
  return id;
}

async function login(phone: string, password: string): Promise<string> {
  const cached = tokens.get(phone);
  if (cached) return cached;
  const res = await api.post("/api/auth/login", { data: { phone, password } });
  const token = ((await res.json()) as { data?: { token?: string } }).data?.token;
  if (!token) throw new Error(`登录失败：${phone}`);
  tokens.set(phone, token);
  return token;
}

async function adminHeaders() {
  return { Authorization: `Bearer ${await login(E2E.admin.phone, E2E.admin.password)}` };
}

async function personHeaders(person: SchedPersonKey) {
  return {
    Authorization: `Bearer ${await login(SCHED_PEOPLE[person].phone, SCHED_LOGIN_PASSWORD)}`,
  };
}

async function toResult(res: APIResponse, marker: string): Promise<CallResult> {
  let body: {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { code?: string; message?: string };
  } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // 非 JSON 应答按失败处理。
  }
  const content = body.choices?.[0]?.message?.content ?? "";
  const matched = /\[key=sk-sched-[A-Za-z0-9]+-([^\]]+)\]/.exec(content);
  return {
    marker,
    status: res.status(),
    key: matched?.[1] ?? null,
    code: body.error?.code ?? null,
    message: body.error?.message ?? null,
    retryAfter: res.headers()["retry-after"] ?? null,
  };
}

async function relay(apiKey: string, label: string, session?: string): Promise<CallResult> {
  markerSeq += 1;
  const marker = `tidal:${label}:${markerSeq}`;
  const res = await api.post("/ai/chat/completions", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(session ? { "x-session-id": session } : {}),
    },
    data: { model: MODEL, messages: [{ role: "user", content: marker }], stream: false },
    timeout: 90_000,
  });
  return toResult(res, marker);
}

/** 用潮汐KEY 发一次调用。 */
function tidalCall(session?: string): Promise<CallResult> {
  return relay(tidalKey, "tidal", session);
}

async function mockControl(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${E2E.mockUpstreamBaseUrl}/__control/${path}`, {
    method: body === undefined && path === "state" ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

async function mockState(): Promise<MockState> {
  return (await mockControl("state")) as MockState;
}

async function setBehaviorAll(behavior: Behavior): Promise<void> {
  for (const label of ALL_LABELS) {
    await mockControl("behavior", { secret: schedSecret(POOL, label), behavior });
  }
}

async function hitsFor(marker: string): Promise<string[]> {
  const prefix = schedSecret(POOL, "");
  const state = await mockState();
  return state.hits
    .filter((hit) => hit.marker === marker)
    .map((hit) => hit.secret.slice(prefix.length));
}

/** 每把 Key 当前在 mock 上游的在途数（没有在途的也列出来，值为 0）。 */
async function inFlightByLabel(): Promise<Record<string, number>> {
  const state = await mockState();
  return Object.fromEntries(
    ALL_LABELS.map((label) => [label, state.inFlight[schedSecret(POOL, label)] ?? 0]),
  );
}

async function waitFor<T>(
  description: string,
  probe: () => Promise<T | null | undefined | false>,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    last = value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`等待超时：${description}（最后一次结果 ${JSON.stringify(last)}）`);
}

async function waitForInFlight(expected: Record<string, number>): Promise<void> {
  let seen: Record<string, number> = {};
  try {
    await waitFor(`mock 在途数达到 ${JSON.stringify(expected)}`, async () => {
      seen = await inFlightByLabel();
      return Object.entries(expected).every(([label, count]) => seen[label] === count);
    });
  } catch (error) {
    throw new Error(`${(error as Error).message}；实际在途 ${JSON.stringify(seen)}`);
  }
}

async function credentialId(label: string): Promise<number> {
  const [row] = await sql<Array<{ id: string }>>`
    select id from upstream_credentials
    where product_line_id = ${tidalLineId} and label = ${`调度-${label}`}
  `;
  if (!row) throw new Error(`夹具缺少渠道 Key ${label}`);
  return Number(row.id);
}

/**
 * 把某把 Key 某个整点小时桶写成指定积分。请求数写得很大：在途请求按「桶内平均
 * 每次积分」估算占用，平均值必须小到可以忽略，档位才只由这里写的数决定。
 */
async function setHourBucket(label: string, hourStart: Date, credits: number): Promise<void> {
  await sql`
    insert into credential_usage_hourly
      (credential_id, hour_start, total_tokens, total_credits, request_count)
    values (${await credentialId(label)}, ${hourStart}, 1000, ${credits}, 100000)
    on conflict (credential_id, hour_start)
    do update set total_credits = excluded.total_credits, request_count = excluded.request_count
  `;
}

function hourStartOf(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

/** 池子里每把 Key 上挂着的成员（员工 ID）。 */
async function membersByKey(): Promise<Record<string, number[]>> {
  const rows = await sql<Array<{ label: string; employee_id: string }>>`
    select uc.label, m.employee_id
    from credential_binding_members m
    join credential_bindings b on b.id = m.binding_id
    join upstream_credentials uc on uc.id = b.credential_id
    where uc.product_line_id = ${tidalLineId}
    order by uc.label, m.employee_id
  `;
  const result: Record<string, number[]> = {};
  for (const row of rows) {
    (result[row.label.replace(/^调度-/, "")] ??= []).push(Number(row.employee_id));
  }
  return result;
}

/** 服务端所在时区的 HH:mm。 */
function wallClock(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

const BASE_SETTINGS = {
  weeklyTiers: [0.05, 0.2],
  weeklyLine: 0.5,
  fiveHourLine: 0.6,
  perKeyConcurrency: 2,
};

async function putSettings(patch: Partial<TidalSettings>): Promise<TidalSettings> {
  const body: TidalSettings = {
    enabled: true,
    windowStart: wallClock(minutesFromNow(-60)),
    windowEnd: wallClock(minutesFromNow(60)),
    ...BASE_SETTINGS,
    ...patch,
  };
  const res = await api.put("/api/admin/tidal/settings", {
    headers: await adminHeaders(),
    data: body,
  });
  expect(res.status(), "管理员保存潮汐设置").toBe(200);
  return ((await res.json()) as { data: { settings: TidalSettings } }).data.settings;
}

type MyKeys = {
  data: Array<{ id: number; name: string; tidal?: boolean }>;
  tidal?: {
    maxConcurrency: number;
    rpmLimit: number;
    expiresAt: string | null;
    hasKey: boolean;
    windowStart: string;
    windowEnd: string;
  };
};

async function myKeys(person: SchedPersonKey): Promise<{ raw: string; body: MyKeys }> {
  const res = await api.get("/api/me/api-keys", { headers: await personHeaders(person) });
  expect(res.status()).toBe(200);
  const raw = await res.text();
  return { raw, body: JSON.parse(raw) as MyKeys };
}

async function createTidalKey(person: SchedPersonKey): Promise<APIResponse> {
  const [team] = await sql<Array<{ team_id: string }>>`
    select team_id from team_members where employee_id = ${employeeId(person)} limit 1
  `;
  return api.post("/api/me/api-keys", {
    headers: await personHeaders(person),
    data: {
      name: "潮汐测试",
      teamId: Number(team.team_id),
      productLineId: tidalLineId,
      tidal: true,
    },
  });
}

async function opsAuditActions(): Promise<string[]> {
  const rows = await sql<Array<{ action: string }>>`
    select action from ops_audit_logs where action like 'tidal.%' order by id
  `;
  return rows.map((row) => row.action);
}

async function uiLogin(page: Page, phone: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByText("账户登录", { exact: true }).click();
  await page.getByPlaceholder("11 位手机号").fill(phone);
  await page.getByPlaceholder("请输入密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
}

test.describe.serial("潮汐调度", () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: E2E.apiBaseUrl });
    sql = postgres(E2E.databaseUrl, { max: 2 });

    const [line] = await sql<Array<{ id: string }>>`
      select id from product_lines where code = 'hz_sched_tidal'
    `;
    expect(line, "seed-scheduling 应写入潮汐渠道").toBeTruthy();
    tidalLineId = Number(line.id);
    const people = await sql<Array<{ id: string; phone: string }>>`
      select id, phone from employees where phone like '1390000%'
    `;
    for (const key of Object.keys(SCHED_PEOPLE) as SchedPersonKey[]) {
      const row = people.find((item) => item.phone === SCHED_PEOPLE[key].phone);
      if (row) employeeIds.set(key, Number(row.id));
    }

    // 周窗口固定为「3 天后重置」，下面写在 6 小时前的用量一定落在本周窗口内。
    await sql`
      update product_lines
      set weekly_window_reset_at = ${new Date(Date.now() + 3 * 24 * HOUR_MS)}
      where id = ${tidalLineId}
    `;
    // 依赖「当前这个小时桶」的用量避开整点前后几秒。
    const msIntoHour = Date.now() % HOUR_MS;
    if (msIntoHour > HOUR_MS - 15_000) {
      await new Promise((done) => setTimeout(done, HOUR_MS - msIntoHour + 1_000));
    }
    const sixHoursAgo = hourStartOf(new Date(Date.now() - 6 * HOUR_MS));
    await setHourBucket("td03", sixHoursAgo, 100); // 周 10%，不在 5 小时窗口里
    await setHourBucket("td04", sixHoursAgo, 600); // 周 60%
    await setHourBucket("td05", hourStartOf(new Date()), 70); // 5 小时 70%，周 7%
  });

  test.beforeEach(async () => {
    await mockControl("reset", {});
  });

  test.afterAll(async () => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(resolve(ARTIFACT_DIR, "tidal.json"), `${JSON.stringify(report, null, 2)}\n`);
    await mockControl("reset", {});
    await api?.dispose();
    await sql?.end({ timeout: 5 });
  });

  test("授权门禁：没授权看不到也建不了，只有超级管理员能授权，一人一把", async () => {
    // 1. 没授权：列表里没有任何潮汐字段，带 tidal 的创建请求和乱填参数一个下场。
    const plainBefore = await myKeys("tdPlain");
    expect(plainBefore.raw.toLowerCase(), "没授权的员工不应看到潮汐字段").not.toContain("tidal");
    const denied = await createTidalKey("tdUser");
    expect(denied.status(), "没授权时建不出潮汐KEY").toBe(400);
    const [{ n: keysBefore }] = await sql<Array<{ n: number }>>`
      select count(*)::int n from employee_api_keys where mode = 'tidal'
    `;
    expect(keysBefore, "没授权时库里不应出现潮汐KEY").toBe(0);

    // 2. 企业管理员碰不到潮汐调度。
    const orgAdmin = await personHeaders("tdOrgAdmin");
    const orgAdminStatuses = [
      (await api.get("/api/admin/tidal/settings", { headers: orgAdmin })).status(),
      (await api.get("/api/admin/tidal/grants", { headers: orgAdmin })).status(),
      (
        await api.post("/api/admin/tidal/grants", {
          headers: orgAdmin,
          data: { employeeId: employeeId("tdOrgAdmin"), maxConcurrency: 50, rpmLimit: 600 },
        })
      ).status(),
    ];
    expect(orgAdminStatuses, "企业管理员不能读写潮汐调度").toEqual([403, 403, 403]);

    // 超级管理员：打开总开关、时段覆盖当前时刻，给 tdUser 授权 8 并发。
    const settingsRes = await api.get("/api/admin/tidal/settings", { headers: await adminHeaders() });
    expect(settingsRes.status()).toBe(200);
    const initial = (await settingsRes.json()) as {
      data: { settings: TidalSettings; timezone: string };
    };
    timezone = initial.data.timezone;
    expect(initial.data.settings.enabled, "潮汐调度默认关闭").toBe(false);
    const settings = await putSettings({});

    const grantRes = await api.post("/api/admin/tidal/grants", {
      headers: await adminHeaders(),
      data: {
        employeeId: employeeId("tdUser"),
        maxConcurrency: 8,
        rpmLimit: 600,
        note: "Agent 夜间测试",
      },
    });
    expect(grantRes.status(), "超级管理员授权").toBe(200);
    grantId = ((await grantRes.json()) as { data: { id: number } }).data.id;

    // 3. 授权后：看得到授权信息，能建一把，建不出第二把。
    const granted = await myKeys("tdUser");
    expect(granted.body.tidal, "被授权的员工应看到授权信息").toMatchObject({
      maxConcurrency: 8,
      rpmLimit: 600,
      hasKey: false,
      windowStart: settings.windowStart,
      windowEnd: settings.windowEnd,
    });
    const created = await createTidalKey("tdUser");
    expect(created.status(), "授权后能建潮汐KEY").toBe(200);
    const createdBody = (await created.json()) as { data: { id: number; key: string; tidal: boolean } };
    expect(createdBody.data.tidal).toBe(true);
    tidalKey = createdBody.data.key;
    expect(tidalKey.startsWith("th_")).toBe(true);
    const second = await createTidalKey("tdUser");
    expect(second.status(), "一个人只能有一把潮汐KEY").toBe(409);

    const after = await myKeys("tdUser");
    expect(after.body.tidal?.hasKey).toBe(true);
    expect(
      after.body.data.filter((row) => row.tidal).map((row) => row.id),
      "列表里恰好一把潮汐KEY",
    ).toEqual([createdBody.data.id]);
    const plainAfter = await myKeys("tdPlain");
    expect(plainAfter.raw.toLowerCase(), "别人被授权不影响没授权的人").not.toContain("tidal");

    // 4. 运维审计。
    const actions = await opsAuditActions();
    expect(actions).toEqual(expect.arrayContaining(["tidal.settings.update", "tidal.grant.create"]));

    report.auth = {
      unauthorizedCreateStatus: denied.status(),
      orgAdminStatuses,
      grant: granted.body.tidal,
      secondKeyStatus: second.status(),
      opsAudit: actions,
    };
  });

  test("开放时段与总开关：时段外、关闭时都明确拒绝，不打上游", async () => {
    // 5. 时段在两小时之后才开始。
    const closed = await putSettings({
      windowStart: wallClock(minutesFromNow(120)),
      windowEnd: wallClock(minutesFromNow(180)),
    });
    const outside = await tidalCall();
    expect(outside.status, "时段外应明确拒绝").toBe(403);
    expect(outside.code).toBe("tidal_window_closed");
    expect(outside.message ?? "", "提示里要写出开放时段").toContain(closed.windowStart);
    expect(await hitsFor(outside.marker), "时段外不应打上游").toEqual([]);

    // 6. 总开关关闭。
    await putSettings({ enabled: false });
    const disabled = await tidalCall();
    expect(disabled.status, "关闭后应明确拒绝").toBe(403);
    expect(disabled.code).toBe("tidal_disabled");
    expect(await hitsFor(disabled.marker)).toEqual([]);

    await putSettings({});
    const open = await tidalCall();
    expect(open.status, "时段内、已开启时可用").toBe(200);

    report.window = {
      outside: { status: outside.status, code: outside.code, message: outside.message },
      disabled: { status: disabled.status, code: disabled.code },
      open: { status: open.status, key: open.key },
    };
  });

  test("铺得薄：每把 Key 最多 2 个潮汐并发，先用周用量最低的档，越线的和外企的不用", async () => {
    await setBehaviorAll({ type: "hold" });
    const pending: Array<Promise<CallResult>> = [];

    // 7 / 8 / 12：授权 8 并发，8 个请求正好铺满第一档的 4 把 Key，第二档一个都不用。
    for (let index = 0; index < 8; index += 1) pending.push(tidalCall());
    await waitForInFlight({ td01: 2, td02: 2, td07: 2, td08: 2 });
    const afterEight = await inFlightByLabel();
    expect(afterEight, "第一档有空位时不动第二档，也不碰越线和外企的 Key").toEqual({
      td01: 2, td02: 2, td03: 0, td04: 0, td05: 0, td06: 0, td07: 2, td08: 2,
    });

    // 12：第 9 个超过授权的并发上限。
    const overGrant = await tidalCall();
    expect(overGrant.status, "超过授权并发应 429").toBe(429);
    expect(overGrant.code).toBe("concurrency_limit_exceeded");
    expect(await hitsFor(overGrant.marker), "被并发上限拦下的请求不打上游").toEqual([]);

    // 13：潮汐不加入成员关系。
    expect(await membersByKey(), "潮汐请求不应成为任何 Key 的成员").toEqual({});

    // 管理员把并发调到 12：多出来的 2 个落到第二档的 td03。
    const patched = await api.patch(`/api/admin/tidal/grants/${grantId}`, {
      headers: await adminHeaders(),
      data: { maxConcurrency: 12 },
    });
    expect(patched.status()).toBe(200);
    pending.push(tidalCall(), tidalCall());
    await waitForInFlight({ td03: 2 });

    // 9 / 10 / 11 / 14：剩下的 td04（周越线）、td05（5 小时越线）、td06（外企）都不能用。
    const noSlot = await tidalCall();
    expect(noSlot.status, "没有潮汐空位时立刻 429").toBe(429);
    expect(noSlot.code).toBe("model_channels_busy");
    expect(Number(noSlot.retryAfter), "429 应带 retry-after").toBeGreaterThan(0);
    expect(await hitsFor(noSlot.marker), "没有空位时不打上游").toEqual([]);

    // 15：主人回来，用自己的普通 Key，直接落在自己的 td01 上并成为成员。
    pending.push(relay(schedApiKey(POOL, "tdO1"), "owner"));
    await waitForInFlight({ td01: 3 });
    expect(await membersByKey(), "主人照常绑定到自己的 Key").toEqual({ td01: [employeeId("tdO1")] });

    await setBehaviorAll({ type: "ok" });
    await mockControl("release", {});
    const results = await Promise.all(pending);
    expect(results.map((result) => result.status), "挂起的请求全部正常完成").toEqual(
      results.map(() => 200),
    );

    const state = await mockState();
    const peak = Object.fromEntries(
      ALL_LABELS.map((label) => [label, state.maxInFlight[schedSecret(POOL, label)] ?? 0]),
    );
    expect(peak, "各 Key 的峰值在途：潮汐每把最多 2，td01 另加主人的 1 个").toEqual({
      td01: 3, td02: 2, td03: 2, td04: 0, td05: 0, td06: 0, td07: 2, td08: 2,
    });

    // 16：td01 上现在有成员（主人刚用过），潮汐的新请求要绕开它。
    const picks: Array<string | null> = [];
    for (let index = 0; index < 6; index += 1) picks.push((await tidalCall()).key);
    expect(picks, "有成员在用的 Key 不再接潮汐请求").not.toContain("td01");
    expect(
      picks.every((key) => key != null && FIRST_TIER.includes(key)),
      `空闲时仍只用第一档：${JSON.stringify(picks)}`,
    ).toBe(true);

    report.spread = {
      afterEight,
      overGrant: { status: overGrant.status, code: overGrant.code },
      noSlot: { status: noSlot.status, code: noSlot.code, retryAfter: noSlot.retryAfter },
      peakInFlight: peak,
      picksWhileOwnerActive: picks,
    };
  });

  test("会话粘性：同一会话粘一把 Key，不同会话铺开，粘着的 Key 不能用了就换", async () => {
    // 17
    const sessionA = [
      (await tidalCall("sess-a")).key,
      (await tidalCall("sess-a")).key,
      (await tidalCall("sess-a")).key,
    ];
    const sessionB = [
      (await tidalCall("sess-b")).key,
      (await tidalCall("sess-b")).key,
      (await tidalCall("sess-b")).key,
    ];
    expect(new Set(sessionA).size, `会话 A 应粘在一把 Key 上：${JSON.stringify(sessionA)}`).toBe(1);
    expect(new Set(sessionB).size, `会话 B 应粘在一把 Key 上：${JSON.stringify(sessionB)}`).toBe(1);
    expect(sessionA[0], "应是可用的 Key").not.toBeNull();
    expect(sessionB[0], "两个会话应铺到不同的 Key 上").not.toBe(sessionA[0]);

    // 18：停用会话 A 粘着的 Key。
    const stuck = sessionA[0]!;
    await sql`
      update upstream_credentials set status = 'disabled', updated_at = now()
      where id = ${await credentialId(stuck)}
    `;
    const moved = [(await tidalCall("sess-a")).key, (await tidalCall("sess-a")).key];
    await sql`
      update upstream_credentials set status = 'active', updated_at = now()
      where id = ${await credentialId(stuck)}
    `;
    expect(moved[0], "粘着的 Key 停用后会话应换 Key").not.toBeNull();
    expect(moved[0]).not.toBe(stuck);
    expect(moved[1], "换过去之后继续粘在新的 Key 上").toBe(moved[0]);

    report.sessions = { sessionA, sessionB, movedAfterDisable: moved };
  });

  test("用量照常统计：和普通请求一样计入用量，日志里标出潮汐，渠道 Key 的账本照记", async () => {
    const userId = employeeId("tdUser");
    // 19
    const [audits] = await sql<Array<{ total: number; tidal: number }>>`
      select count(*)::int total, (count(*) filter (where tidal))::int tidal
      from request_audits where employee_id = ${userId}
    `;
    expect(audits.total, "前面的用例已经产生了潮汐请求").toBeGreaterThan(10);
    expect(audits.tidal, "tdUser 只有潮汐KEY，他的请求应全部标记为潮汐").toBe(audits.total);
    // tdUser 只有潮汐KEY：用量计数里的请求数应该和他的审计行数一样多，一条不少。
    const [daily] = await sql<Array<{ n: number }>>`
      select coalesce(sum(request_count), 0)::int n from usage_counters_daily
      where employee_id = ${userId}
    `;
    const [teamDaily] = await sql<Array<{ n: number }>>`
      select coalesce(sum(request_count), 0)::int n from usage_counters_team_daily
      where employee_id = ${userId}
    `;
    expect([daily.n, teamDaily.n], "潮汐请求和普通请求一样计入员工、部门的用量统计").toEqual([
      audits.total,
      audits.total,
    ]);

    const logsRes = await api.get("/api/me/logs?limit=5", { headers: await personHeaders("tdUser") });
    const logs = (await logsRes.json()) as { data: { items: Array<{ tidal: boolean }> } };
    expect(logs.data.items.length).toBeGreaterThan(0);
    expect(logs.data.items.every((item) => item.tidal === true), "请求日志应标出潮汐").toBe(true);

    // 主人自己的请求不是潮汐，照常计入日常用量。
    const [ownerAudits] = await sql<Array<{ total: number; tidal: number }>>`
      select count(*)::int total, (count(*) filter (where tidal))::int tidal
      from request_audits where employee_id = ${employeeId("tdO1")}
    `;
    expect(ownerAudits, "普通 Key 的请求不带潮汐标记").toEqual({ total: 1, tidal: 0 });
    const [ownerDaily] = await sql<Array<{ n: number }>>`
      select coalesce(sum(request_count), 0)::int n from usage_counters_daily
      where employee_id = ${employeeId("tdO1")}
    `;
    expect(ownerDaily.n, "普通 Key 的请求照常计入日常用量").toBe(1);

    // 20：潮汐的消耗记在渠道 Key 的账本上（td02 没写过夹具用量，只有潮汐请求）。
    const [ledger] = await sql<Array<{ requests: number }>>`
      select coalesce(sum(request_count), 0)::int requests from credential_usage_hourly
      where credential_id = ${await credentialId("td02")}
    `;
    expect(ledger.requests, "潮汐请求应记到渠道 Key 的账本").toBeGreaterThan(0);

    report.usage = {
      tidalAudits: audits,
      dailyCounterRequests: daily.n,
      teamDailyCounterRequests: teamDaily.n,
      ownerAudits,
      td02LedgerRequests: ledger.requests,
    };
  });

  test("界面：管理端有「潮汐调度」页，员工端只有被授权的人看到潮汐KEY", async ({ browser }) => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });

    // 23
    // 视口开高一些：内容区是内部滚动的，整页截图只截得到视口这么高。
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
    const adminPage = await adminContext.newPage();
    await uiLogin(adminPage, E2E.admin.phone, E2E.admin.password);
    await expect(adminPage).toHaveURL(/\/admin/, { timeout: 15_000 });
    // 入口在「上游」分组里。
    await adminPage.locator(".aside-menu").getByText("上游", { exact: true }).click();
    await adminPage.locator(".aside-menu").getByText("潮汐调度", { exact: true }).click();
    await expect(adminPage).toHaveURL(/\/admin\/tidal$/);
    await expect(adminPage.getByRole("heading", { name: "潮汐调度" })).toBeVisible();
    await expect(adminPage.getByText(SCHED_PEOPLE.tdUser.name).first()).toBeVisible();
    // 规则和运行情况都加载完再截图：状态是「开放中」，潮汐池里能看到各档可借的 Key。
    await expect(adminPage.locator(".page-head").getByText("开放中")).toBeVisible();
    await expect(adminPage.getByRole("row", { name: /调度E2E-潮汐/ })).toBeVisible();
    await expect(adminPage.locator(".stat strong").first()).not.toHaveText("0");
    await adminPage.waitForTimeout(500);
    await adminPage.screenshot({ path: resolve(ARTIFACT_DIR, "tidal-admin.png"), fullPage: true });

    // 25：在界面上给另一个人授权——按姓名搜、按手机号搜都要能找到。
    const target = SCHED_PEOPLE.tdO2;
    await adminPage.getByRole("button", { name: "新增授权" }).click();
    const dialog = adminPage.locator(".el-dialog", { hasText: "新增授权" });
    await expect(dialog).toBeVisible();
    const option = adminPage.locator(".el-select-dropdown__item", { hasText: target.name });
    await dialog.locator(".el-select").click();
    await adminPage.keyboard.type(target.phone);
    await expect(option, "按手机号应能搜到员工").toBeVisible();
    await adminPage.keyboard.press("ControlOrMeta+A");
    await adminPage.keyboard.type(target.name);
    await expect(option, "按姓名应能搜到员工").toBeVisible();
    await option.click();
    await dialog.getByRole("button", { name: "确定" }).click();
    await expect(adminPage.getByRole("row", { name: new RegExp(target.name) })).toBeVisible();
    const [uiGrant] = await sql<Array<{ max_concurrency: number }>>`
      select max_concurrency from tidal_grants where employee_id = ${employeeId("tdO2")}
    `;
    expect(uiGrant, "界面上的授权应写入库").toBeTruthy();
    await adminContext.close();

    // 24
    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await uiLogin(userPage, SCHED_PEOPLE.tdUser.phone, SCHED_LOGIN_PASSWORD);
    await expect(userPage).toHaveURL(/\/me/, { timeout: 15_000 });
    await userPage.goto("/me/keys");
    const userBoard = userPage.locator(".key-board");
    await expect(userBoard.getByRole("heading", { name: "潮汐KEY" })).toBeVisible();
    await expect(userBoard.getByText("并发上限 12")).toBeVisible();
    await userPage.screenshot({ path: resolve(ARTIFACT_DIR, "tidal-employee.png"), fullPage: true });
    await userContext.close();

    const plainContext = await browser.newContext();
    const plainPage = await plainContext.newPage();
    await uiLogin(plainPage, SCHED_PEOPLE.tdPlain.phone, SCHED_LOGIN_PASSWORD);
    await expect(plainPage).toHaveURL(/\/me/, { timeout: 15_000 });
    await plainPage.goto("/me/keys");
    // 等自己的 Key 列表渲染出来再断言；账号名里带「潮汐」两个字，所以只看 Key 列表这一块。
    const plainBoard = plainPage.locator(".key-board");
    await expect(plainBoard.locator(".key-row").first()).toBeVisible();
    await expect(plainBoard.getByText("潮汐")).toHaveCount(0);
    await plainContext.close();

    report.ui = {
      screenshots: ["tidal-admin.png", "tidal-employee.png"],
      grantedInDialog: { employee: target.name, maxConcurrency: uiGrant.max_concurrency },
    };
  });

  test("到期与撤销：到期后 KEY 失效并隐藏，撤销后 KEY 被删除", async () => {
    // 21：把到期时间拨到过去，相当于时间走到了到期之后。
    await sql`update tidal_grants set expires_at = ${new Date(Date.now() - 60_000)} where id = ${grantId}`;
    const expired = await tidalCall();
    expect(expired.status, "到期后潮汐KEY 失效").toBe(401);
    expect(expired.code).toBe("invalid_api_key");
    const hidden = await myKeys("tdUser");
    expect(hidden.raw.toLowerCase(), "到期后员工看不到潮汐KEY").not.toContain("tidal");

    await sql`update tidal_grants set expires_at = null where id = ${grantId}`;
    const restored = await tidalCall();
    expect(restored.status, "续期后同一把 KEY 恢复可用").toBe(200);

    // 22
    const revoked = await api.delete(`/api/admin/tidal/grants/${grantId}`, {
      headers: await adminHeaders(),
    });
    expect(revoked.status()).toBe(200);
    const afterRevoke = await tidalCall();
    expect(afterRevoke.status, "撤销后潮汐KEY 失效").toBe(401);
    const [{ n: remaining }] = await sql<Array<{ n: number }>>`
      select count(*)::int n from employee_api_keys where mode = 'tidal'
    `;
    expect(remaining, "撤销授权时潮汐KEY 一并删除").toBe(0);
    const gone = await myKeys("tdUser");
    expect(gone.raw.toLowerCase()).not.toContain("tidal");

    const actions = await opsAuditActions();
    expect(actions).toEqual(
      expect.arrayContaining(["tidal.grant.update", "tidal.grant.revoke"]),
    );

    report.lifecycle = {
      expiredStatus: expired.status,
      restoredStatus: restored.status,
      revokedStatus: afterRevoke.status,
      tidalKeysLeft: remaining,
      opsAudit: actions,
    };
  });
});
