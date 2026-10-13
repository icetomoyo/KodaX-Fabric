import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import postgres from "postgres";
import { E2E } from "./env.ts";
import {
  SCHED_PEOPLE,
  SCHED_POOLS,
  schedApiKey,
  schedSecret,
  type SchedPersonKey,
  type SchedPoolKey,
} from "./scheduling-fixture.ts";

/**
 * 渠道 Key 调度 E2E：亲和度选 Key、每把 Key 最多 3 人 / 5 并发、按成员 30 分钟
 * 释放、席位主人保护、上游 429 按业务码分类处理。
 *
 * 全程走真实 HTTP 进真实 server，上游是本机可编排的 mock（按 Bearer 认 Key、
 * 回显是哪把 Key 应答）。每个场景独占一条渠道（一个调度池）。夹具见
 * seed-scheduling.ts，全是刚注册的新账号：旧逻辑下新账号 7 天内独占一把 Key，
 * 这里它们必须能共享，顺带证明档位已不参与调度。
 *
 * 调度可能出错的方式（每条对应下面一个断言）：
 *  1. 有席位的人没有用到自己的 Key。
 *  2. 没有席位的人没按「同组 > 同部门 > 同一级部门 > 同企业」的顺序借 Key。
 *  3. 一人多部门时没有取最近的那层关系。
 *  4. 借到了别的企业员工名下的 Key；或者充值模式下没有主人的 Key 同时挂了两家企业的人。
 *  5. 已经绑定的人因为更近的 Key 空出来而被来回迁移（不粘）。
 *  6. 主人自己的 Key 恢复可用后，他还留在借来的 Key 上不回去。
 *  7. 一把 Key 上挂了超过 3 个人。
 *  8. 主人回来时自己的 Key 已被借满，结果主人进不去。
 *  9. 一把 Key 同时在途超过 5 个请求（并发突发时的检查与占位不是原子的）。
 * 10. 借用者在 Key 满并发时没有换 Key，或者换到了空位不够的 Key。
 * 11. 主人在自己的 Key 满并发时被解绑，而不是只把这一次请求临时发到别处。
 * 12. 所有 Key 都满并发时请求挂住或报 5xx，而不是立刻 429 带 retry-after。
 * 13. 借用者越过 85% 借用线继续用主人的 Key；或者主人在 85% 被本地拦下。
 * 14. 上游返回 5 小时额度用尽（1308）后没有冷却到重置时刻，或者换 Key 超过 1 次。
 * 15. 上游返回公平使用风控（1313）后 Key 没停用、请求被换 Key 重放、没有告警。
 * 16. 上游模型拥堵（1305）连带冷却了健康的 Key，或者请求在多把 Key 上连扫。
 * 16b. 模型拥堵以 HTTP 529 返回时（线上 1305 多数是 529）被当成普通 5xx，在多把 Key 上连扫。
 * 17. 套餐未开放模型（1311）冷却了 Key。
 * 18. 上游 5xx 时不再换 Key 重试（限流的换 Key 上限误伤了故障重试）。
 * 19. 30 分钟没调用的成员没有被释放；还在用的成员被误释放；最后一人走后 Key 没回池。
 * 20. 管理端画布上的「谁在用哪把 Key」和库里的实际绑定对不上。
 * 21. 5 小时窗口开头不满一小时的用量没有计入（账本按整点分桶）；
 *     或者把同一小时里、窗口开始之前的旧用量也算了进来。
 * 22. 上游 1308 回包给的重置时刻说明窗口比本地记的开始得早，本地窗口起点却没被改正。
 * 23. 没学到自己重置时刻的 Key，周窗口没有跟随套餐上录入的周重置时间。
 * 24. 某把 Key 从上游 1310 回包学到的重置时刻，没有覆盖套餐的默认值。
 * 25. 管理员改了套餐的周重置时间后，Key 上以前学到的旧时刻还在生效。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");
const MODEL = "e2e-upstream-model";

type CallResult = {
  marker: string;
  status: number;
  /** 应答这次请求的渠道 Key 标签（mock 回显），失败时为 null。 */
  key: string | null;
  code: string | null;
  retryAfter: string | null;
};

type MockState = {
  hits: Array<{ seq: number; secret: string; model: string; marker: string | null }>;
  inFlight: Record<string, number>;
  maxInFlight: Record<string, number>;
  alerts: Array<{ text?: { content?: string } } | string>;
};

type Behavior =
  | { type: "ok" }
  | { type: "hold" }
  | { type: "status"; status: number; body: unknown };

let api: APIRequestContext;
let sql: postgres.Sql;
let markerSeq = 0;
const report: Record<string, unknown> = {};

const lineIds = new Map<SchedPoolKey, number>();
const employeeIds = new Map<SchedPersonKey, number>();
const personByEmployeeId = new Map<number, SchedPersonKey>();

function lineId(pool: SchedPoolKey): number {
  const id = lineIds.get(pool);
  if (id == null) throw new Error(`夹具缺少渠道 ${pool}`);
  return id;
}

function employeeId(person: SchedPersonKey): number {
  const id = employeeIds.get(person);
  if (id == null) throw new Error(`夹具缺少员工 ${person}`);
  return id;
}

async function toResult(res: APIResponse, marker: string): Promise<CallResult> {
  let body: {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { code?: string };
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
    retryAfter: res.headers()["retry-after"] ?? null,
  };
}

/** 以某人在某个池子里的 API Key 发一次 relay 调用。 */
async function call(pool: SchedPoolKey, person: SchedPersonKey): Promise<CallResult> {
  markerSeq += 1;
  const marker = `${pool}:${person}:${markerSeq}`;
  const res = await api.post("/ai/chat/completions", {
    headers: { Authorization: `Bearer ${schedApiKey(pool, person)}` },
    data: { model: MODEL, messages: [{ role: "user", content: marker }], stream: false },
    timeout: 90_000,
  });
  return toResult(res, marker);
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

async function setBehavior(pool: SchedPoolKey, label: string, behavior: Behavior): Promise<void> {
  await mockControl("behavior", { secret: schedSecret(pool, label), behavior });
}

/** 这次调用实际打到了哪些渠道 Key（按先后）。 */
async function hitsFor(pool: SchedPoolKey, marker: string): Promise<string[]> {
  const prefix = schedSecret(pool, "");
  const state = await mockState();
  return state.hits
    .filter((hit) => hit.marker === marker)
    .map((hit) => hit.secret.slice(prefix.length));
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

async function waitForInFlight(pool: SchedPoolKey, expected: Record<string, number>): Promise<void> {
  await waitFor(`mock 在途数达到 ${JSON.stringify(expected)}`, async () => {
    const state = await mockState();
    return Object.entries(expected).every(
      ([label, count]) => (state.inFlight[schedSecret(pool, label)] ?? 0) === count,
    );
  });
}

async function credentialRow(pool: SchedPoolKey, label: string) {
  const [row] = await sql<
    Array<{
      id: string;
      status: string;
      cool_until: Date | null;
      last_failure_kind: string | null;
      last_vendor_code: string | null;
    }>
  >`
    select id, status, cool_until, last_failure_kind, last_vendor_code
    from upstream_credentials
    where product_line_id = ${lineId(pool)} and label = ${`调度-${label}`}
  `;
  if (!row) throw new Error(`夹具缺少渠道 Key ${pool}/${label}`);
  return { ...row, id: Number(row.id) };
}

async function setCredentialStatus(
  pool: SchedPoolKey,
  label: string,
  status: "active" | "disabled",
): Promise<void> {
  await sql`
    update upstream_credentials
    set status = ${status}::credential_status, cool_until = null, updated_at = now()
    where product_line_id = ${lineId(pool)} and label = ${`调度-${label}`}
  `;
}

/** 池子里每把 Key 当前挂着谁（库里的真实绑定）。 */
async function membersByKey(pool: SchedPoolKey): Promise<Record<string, SchedPersonKey[]>> {
  const rows = await sql<Array<{ label: string; employee_id: string }>>`
    select uc.label, m.employee_id
    from credential_binding_members m
    join credential_bindings b on b.id = m.binding_id
    join upstream_credentials uc on uc.id = b.credential_id
    where uc.product_line_id = ${lineId(pool)}
    order by uc.label, m.employee_id
  `;
  const result: Record<string, SchedPersonKey[]> = {};
  for (const row of rows) {
    const label = row.label.replace(/^调度-/, "");
    const person = personByEmployeeId.get(Number(row.employee_id));
    if (!person) throw new Error(`绑定里出现了夹具之外的员工 ${row.employee_id}`);
    (result[label] ??= []).push(person);
  }
  for (const people of Object.values(result)) people.sort();
  return result;
}

/** 某人在这个池子里绑定的 Key 标签；没有绑定返回 null。 */
async function boundKey(pool: SchedPoolKey, person: SchedPersonKey): Promise<string | null> {
  const members = await membersByKey(pool);
  for (const [label, people] of Object.entries(members)) {
    if (people.includes(person)) return label;
  }
  return null;
}

async function bindingExists(pool: SchedPoolKey, label: string): Promise<boolean> {
  const credential = await credentialRow(pool, label);
  const rows = await sql`select 1 from credential_bindings where credential_id = ${credential.id}`;
  return rows.length > 0;
}

/**
 * 用例往库里写「过去的时间」一律用本进程的时钟（和被测 server 同一台机器）。
 * 本机数据库跑在 Docker 里，时钟可能和宿主机差几秒，不能用 SQL 的 now()。
 */
function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

/** 上游额度报文里的时间是 Asia/Shanghai 墙上时间。 */
function shanghaiWallTime(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function weeklyCapBody(resetAt: Date) {
  return {
    error: {
      code: "1310",
      message:
        `已达到 7 天使用上限，${shanghaiWallTime(resetAt)} 后可继续使用。` +
        "如需超限额按量付费使用，可联系管理员开启超额按量付费。",
    },
  };
}

const HOUR_MS = 3_600_000;

function hourStartOf(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

/** 把某把 Key 某个整点小时桶的积分直接写成指定值（模拟这一小时里已经发生的用量）。 */
async function setHourBucket(credentialId: number, hourStart: Date, credits: number): Promise<void> {
  await sql`
    insert into credential_usage_hourly
      (credential_id, hour_start, total_tokens, total_credits, request_count)
    values (${credentialId}, ${hourStart}, 1000, ${credits}, 1)
    on conflict (credential_id, hour_start)
    do update set total_credits = excluded.total_credits
  `;
}

/** 依赖「当前这个小时桶」的场景避开整点前后几秒，免得桶在用例中途翻页。 */
async function waitOutHourBoundary(): Promise<void> {
  const msIntoHour = Date.now() % HOUR_MS;
  if (msIntoHour > HOUR_MS - 10_000) {
    await new Promise((done) => setTimeout(done, HOUR_MS - msIntoHour + 1_000));
  }
}

let adminTokenCache: string | null = null;

async function adminToken(): Promise<string> {
  if (adminTokenCache) return adminTokenCache;
  const res = await api.post("/api/auth/login", {
    data: { phone: E2E.admin.phone, password: E2E.admin.password },
  });
  const token = ((await res.json()) as { data?: { token?: string } }).data?.token;
  if (!token) throw new Error("管理员登录失败");
  adminTokenCache = token;
  return token;
}

function fiveHourCapBody(resetAt: Date) {
  return {
    error: {
      code: "1308",
      message:
        `已达到 5 小时使用上限，${shanghaiWallTime(resetAt)} 后可继续使用。` +
        "如需超限额按量付费使用，可联系管理员开启超额按量付费。",
    },
  };
}

const FAIR_USE_BODY = {
  error: {
    code: "1313",
    message:
      "您的账户当前使用模式不符合公平使用策略，请求频率已受到限制。详情请参阅《条款与协议-订阅及自动续费协议》",
  },
};
const MODEL_BUSY_BODY = {
  error: { code: "1305", message: "该模型当前访问量过大，请您稍后再试" },
};
const PLAN_DENIED_BODY = {
  error: { code: "1311", message: `当前订阅套餐暂未开放 ${MODEL} 权限` },
};

test.describe.serial("渠道 Key 调度", () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: E2E.apiBaseUrl });
    sql = postgres(E2E.databaseUrl, { max: 2 });

    const lines = await sql<Array<{ id: string; code: string }>>`
      select id, code from product_lines where code like 'hz_sched_%'
    `;
    for (const pool of Object.keys(SCHED_POOLS) as SchedPoolKey[]) {
      const row = lines.find((line) => line.code === `hz_sched_${pool.toLowerCase()}`);
      if (row) lineIds.set(pool, Number(row.id));
    }
    const people = await sql<Array<{ id: string; phone: string }>>`
      select id, phone from employees where phone like '1390000%'
    `;
    for (const key of Object.keys(SCHED_PEOPLE) as SchedPersonKey[]) {
      const row = people.find((item) => item.phone === SCHED_PEOPLE[key].phone);
      if (!row) continue;
      employeeIds.set(key, Number(row.id));
      personByEmployeeId.set(Number(row.id), key);
    }
    expect(lineIds.size, "seed-scheduling 应写入全部调度渠道").toBe(Object.keys(SCHED_POOLS).length);
    expect(employeeIds.size, "seed-scheduling 应写入全部调度人员").toBe(
      Object.keys(SCHED_PEOPLE).length,
    );
  });

  test.beforeEach(async () => {
    await mockControl("reset", {});
  });

  test.afterAll(async () => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(
      resolve(ARTIFACT_DIR, "key-scheduling.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await mockControl("reset", {});
    await api?.dispose();
    await sql?.end({ timeout: 5 });
  });

  test("亲和度：本人 > 同组 > 同部门 > 同一级部门 > 同企业", async () => {
    const pool = "affinity";
    const ladder = ["self", "leaf", "sub0", "fst0", "ent0"];

    // 每拿到一把就把它停用，逼调度往下一级找。
    const picks: Array<string | null> = [];
    for (const expected of ladder) {
      const result = await call(pool, "self");
      expect(result.status, `本人应能拿到 ${expected}`).toBe(200);
      expect(result.key, `亲和度第 ${picks.length + 1} 顺位应是 ${expected}`).toBe(expected);
      picks.push(result.key);
      await setCredentialStatus(pool, expected, "disabled");
    }

    // 只剩外部企业员工名下的 Key：不能借。
    const exhausted = await call(pool, "self");
    expect(exhausted.status, "没有可借的 Key 时应明确失败").toBe(503);
    expect(await hitsFor(pool, exhausted.marker), "不能打到外部企业的 Key").toEqual([]);
    const outsiderHits = (await mockState()).hits.filter(
      (hit) => hit.secret === schedSecret(pool, "out0"),
    );
    expect(outsiderHits, "外部企业员工名下的 Key 全程不应被本企业的人用到").toEqual([]);

    for (const label of ladder) await setCredentialStatus(pool, label, "active");

    // 主人的 Key 恢复后，下一次请求就回到自己的 Key。
    const home = await call(pool, "self");
    expect(home.key, "自己的 Key 恢复后应回到自己的 Key").toBe("self");

    // 没有席位的同组同事：先借空着的同组 Key；绑定后不因为别的 Key 恢复而迁移。
    const guestFirst = await call(pool, "guest1");
    expect(guestFirst.key, "同分时借人少的那把同组 Key").toBe("leaf");
    await setCredentialStatus(pool, "leaf", "disabled");
    const guestMoved = await call(pool, "guest1");
    expect(guestMoved.key, "当前 Key 不可用时换到另一把同组 Key").toBe("self");
    await setCredentialStatus(pool, "leaf", "active");
    const guestSticky = await call(pool, "guest1");
    expect(guestSticky.key, "已绑定且可用时不迁移").toBe("self");

    // 一人多部门（二部 + 存储小组）：两层关系里取最近的。
    const multiFirst = await call(pool, "multi");
    expect(multiFirst.key, "通过二部与 Key 主人同组").toBe("ent0");
    await setCredentialStatus(pool, "ent0", "disabled");
    const multiSecond = await call(pool, "multi");
    expect(multiSecond.key, "通过存储小组与 Key 主人同组，不能只看第一个部门").toBe("sub0");
    await setCredentialStatus(pool, "ent0", "active");

    report.affinity = {
      ownerLadder: picks,
      noEligibleKeyStatus: exhausted.status,
      ownerReturnsHome: home.key,
      guest: [guestFirst.key, guestMoved.key, guestSticky.key],
      multiDepartment: [multiFirst.key, multiSecond.key],
    };
  });

  test("每把 Key 最多 3 人；主人回来时让出最久没用的借用者", async ({ request }) => {
    const pool = "capacity";

    for (const guest of ["guest1", "guest2", "guest3"] as const) {
      const result = await call(pool, guest);
      expect(result.key, `${guest} 应借到同组主人的 Key`).toBe("capo");
    }
    expect(await membersByKey(pool)).toEqual({ capo: ["guest1", "guest2", "guest3"] });

    const fourth = await call(pool, "guest4");
    expect(fourth.key, "第 4 个人不能再挂到已满 3 人的 Key 上").toBe("capf");

    const owner = await call(pool, "ownerCap");
    expect(owner.key, "主人必须能用上自己的 Key").toBe("capo");
    const afterOwner = await membersByKey(pool);
    expect(afterOwner.capo, "主人进来后仍是 3 人，让出最久没用的借用者").toEqual([
      "guest2",
      "guest3",
      "ownerCap",
    ]);

    const evicted = await call(pool, "guest1");
    expect(evicted.key, "被让出的借用者下次请求换到别的 Key").toBe("capf");
    const final = await membersByKey(pool);
    expect(final).toEqual({
      capf: ["guest1", "guest4"],
      capo: ["guest2", "guest3", "ownerCap"],
    });
    for (const [label, people] of Object.entries(final)) {
      expect(people.length, `${label} 不应超过 3 人`).toBeLessThanOrEqual(3);
    }

    // 管理端画布：虚拟 Key → 渠道 Key 的连线必须等于库里的成员关系。
    const login = await request.post("/api/auth/login", {
      data: { phone: E2E.admin.phone, password: E2E.admin.password },
    });
    const token = ((await login.json()) as { data?: { token?: string } }).data?.token;
    expect(token, "管理员登录").toBeTruthy();
    const graphRes = await request.get(`/api/admin/key-bindings?productLineId=${lineId(pool)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(graphRes.status()).toBe(200);
    const graph = (
      (await graphRes.json()) as {
        data: {
          virtualKeys: Array<{ id: number; employeeId: number }>;
          credentials: Array<{ id: number; label: string; bound: boolean }>;
          edges: Array<{ sourceType: string; sourceId: number; targetType: string; targetId: number }>;
        };
      }
    ).data;
    const keyOwner = new Map(graph.virtualKeys.map((row) => [row.id, row.employeeId]));
    const credentialLabel = new Map(
      graph.credentials.map((row) => [row.id, row.label.replace(/^调度-/, "")]),
    );
    const graphMembers: Record<string, SchedPersonKey[]> = {};
    for (const edge of graph.edges) {
      if (edge.sourceType !== "virtual_key" || edge.targetType !== "credential") continue;
      const person = personByEmployeeId.get(keyOwner.get(edge.sourceId) ?? -1);
      const label = credentialLabel.get(edge.targetId);
      if (!person || !label) continue;
      (graphMembers[label] ??= []).push(person);
    }
    for (const people of Object.values(graphMembers)) people.sort();
    expect(graphMembers, "画布连线应与库里的绑定一致").toEqual(final);

    report.capacity = { afterThreeGuests: "capo", fourthGuest: fourth.key, final, graphMembers };
  });

  test("每把 Key 最多 5 并发：借用者换 Key，主人临时溢出，全满时 429", async () => {
    const pool = "burst";
    await setBehavior(pool, "bsto", { type: "hold" });
    await setBehavior(pool, "bstf", { type: "hold" });
    const pending: Array<Promise<CallResult>> = [];

    // 主人和两个借用者各 1 个在途，都在主人的 Key 上。
    pending.push(call(pool, "ownerBurst"), call(pool, "guest1"), call(pool, "guest2"));
    await waitForInFlight(pool, { bsto: 3 });
    expect(await boundKey(pool, "guest2")).toBe("bsto");

    // guest2 突然再发 4 个：前 2 个把 Key 填到 5，之后 guest2 解绑换到有空位的 Key。
    for (let index = 0; index < 4; index += 1) pending.push(call(pool, "guest2"));
    await waitForInFlight(pool, { bsto: 5, bstf: 2 });
    expect(await boundKey(pool, "guest2"), "满并发时到达的借用者换 Key").toBe("bstf");
    expect(await boundKey(pool, "guest1"), "没发新请求的借用者不受影响").toBe("bsto");

    // 主人在自己的 Key 满并发时：只这一次请求临时发到别处，绑定不动。
    pending.push(call(pool, "ownerBurst"));
    await waitForInFlight(pool, { bsto: 5, bstf: 3 });
    expect(await boundKey(pool, "ownerBurst"), "主人不解绑").toBe("bsto");

    // 把第二把 Key 也填满。
    pending.push(call(pool, "guest3"), call(pool, "guest3"));
    await waitForInFlight(pool, { bsto: 5, bstf: 5 });

    const rejected = await call(pool, "guest1");
    expect(rejected.status, "所有 Key 都满并发时立刻 429").toBe(429);
    expect(rejected.code).toBe("model_channels_busy");
    expect(Number(rejected.retryAfter), "429 应带 retry-after").toBeGreaterThan(0);
    expect(await hitsFor(pool, rejected.marker), "满并发时不应再打上游").toEqual([]);
    expect(await boundKey(pool, "guest1"), "换不到 Key 时保留原绑定").toBe("bsto");

    await setBehavior(pool, "bsto", { type: "ok" });
    await setBehavior(pool, "bstf", { type: "ok" });
    await mockControl("release", {});
    const results = await Promise.all(pending);
    expect(results.map((result) => result.status), "挂起的请求全部正常完成").toEqual(
      results.map(() => 200),
    );
    const served = { bsto: 0, bstf: 0 } as Record<string, number>;
    for (const result of results) served[result.key ?? "none"] = (served[result.key ?? "none"] ?? 0) + 1;
    expect(served).toEqual({ bsto: 5, bstf: 5 });

    const state = await mockState();
    const maxInFlight = {
      bsto: state.maxInFlight[schedSecret(pool, "bsto")] ?? 0,
      bstf: state.maxInFlight[schedSecret(pool, "bstf")] ?? 0,
    };
    expect(maxInFlight, "任何时刻单把 Key 在途都不超过 5").toEqual({ bsto: 5, bstf: 5 });

    report.burst = {
      served,
      maxInFlight,
      rejectedWhenFull: { status: rejected.status, code: rejected.code, retryAfter: rejected.retryAfter },
      finalBindings: await membersByKey(pool),
    };
  });

  test("借用者到 85% 让出，主人用到上游真的限额；1308 冷却到重置时刻且只换一次 Key", async () => {
    const pool = "quota";
    const ownerKey = await credentialRow(pool, "qtao");

    const guestBefore = await call(pool, "guest1");
    expect(guestBefore.key, "借用者先用同组主人的 Key").toBe("qtao");

    // 把这把 Key 当前 5 小时窗口的本地用量写到 90%（额度 100）。
    const setUsage = async (credits: number) => {
      const hourStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
      await sql`
        update upstream_credentials
        set five_hour_window_anchor = ${hourStart}
        where id = ${ownerKey.id}
      `;
      await sql`
        insert into credential_usage_hourly
          (credential_id, hour_start, total_tokens, total_credits, request_count)
        values (${ownerKey.id}, ${hourStart}, 1000, ${credits}, 1)
        on conflict (credential_id, hour_start)
        do update set total_credits = excluded.total_credits
      `;
    };
    await setUsage(90);

    const guestAfter = await call(pool, "guest1");
    expect(guestAfter.key, "借用者越过 85% 借用线后换 Key").toBe("qtaf");
    const ownerAt90 = await call(pool, "ownerQuota");
    expect(ownerAt90.key, "主人不受 85% 借用线限制").toBe("qtao");

    await setUsage(100);
    const ownerAt100 = await call(pool, "ownerQuota");
    expect(ownerAt100.key, "本地估算到 100% 也不拦主人，以上游为准").toBe("qtao");

    // 上游真的返回 5 小时额度用尽。
    const resetAt = new Date(Date.now() + 2 * 3_600_000);
    await setBehavior(pool, "qtao", { type: "status", status: 429, body: fiveHourCapBody(resetAt) });
    const capped = await call(pool, "ownerQuota");
    expect(capped.status, "撞到上游限额后换一次 Key 完成请求").toBe(200);
    expect(capped.key).toBe("qtaf");
    expect(await hitsFor(pool, capped.marker)).toEqual(["qtao", "qtaf"]);

    const cooled = await credentialRow(pool, "qtao");
    expect(cooled.status, "撞限额的 Key 进入冷却").toBe("cooling");
    expect(cooled.last_vendor_code).toBe("1308");
    expect(cooled.cool_until, "冷却应带截止时间").toBeTruthy();
    const driftMs = Math.abs(cooled.cool_until!.getTime() - resetAt.getTime());
    expect(driftMs, "冷却截止时间应等于上游给的重置时刻").toBeLessThan(2_000);

    // 上游说窗口在 resetAt 结束，即窗口从 resetAt − 5h 开始，比本地记的起点早：以上游为准。
    const [anchorRow] = await sql<Array<{ five_hour_window_anchor: Date | null }>>`
      select five_hour_window_anchor from upstream_credentials where id = ${ownerKey.id}
    `;
    const anchorDriftMs = Math.abs(
      (anchorRow.five_hour_window_anchor?.getTime() ?? 0) - (resetAt.getTime() - 5 * HOUR_MS),
    );
    expect(anchorDriftMs, "5 小时窗口起点应校准为上游重置时刻 − 5 小时").toBeLessThan(2_000);

    report.quota = {
      guestBeforeLine: guestBefore.key,
      guestAfterLine: guestAfter.key,
      ownerAt90: ownerAt90.key,
      ownerAt100: ownerAt100.key,
      afterUpstreamCap: {
        hits: ["qtao", "qtaf"],
        status: cooled.status,
        vendorCode: cooled.last_vendor_code,
        coolUntilDriftMs: driftMs,
        windowStartDriftMs: anchorDriftMs,
      },
    };
  });

  test("5 小时窗口：开头不满一小时的用量要计入，窗口开始前同一小时的旧用量不计入", async () => {
    const pool = "window5h";
    await waitOutHourBoundary();
    const key = await credentialRow(pool, "w5ho");
    const thisHour = hourStartOf(new Date());

    // 这把 Key 的上一个窗口早已过期；本小时里已有 60 积分是上一个窗口留下的。
    await sql`
      update upstream_credentials set five_hour_window_anchor = ${minutesAgo(6 * 60)}
      where id = ${key.id}
    `;
    await setHourBucket(key.id, thisHour, 60);

    const first = await call(pool, "guest1");
    expect(first.key, "窗口已过期，旧用量不影响借用").toBe("w5ho");
    const [afterAnchor] = await sql<
      Array<{ five_hour_window_anchor: Date; five_hour_window_base_credits: string }>
    >`
      select five_hour_window_anchor, five_hour_window_base_credits
      from upstream_credentials where id = ${key.id}
    `;
    expect(
      Date.now() - afterAnchor.five_hour_window_anchor.getTime(),
      "这次成功调用是新窗口的起点",
    ).toBeLessThan(30_000);
    expect(Number(afterAnchor.five_hour_window_base_credits), "记下窗口开始前本小时已有的积分").toBe(60);

    // 新窗口里用了 30：本小时桶共 90，但属于新窗口的只有 30%，借用者不该让出。
    await setHourBucket(key.id, thisHour, 90);
    const light = await call(pool, "guest1");
    expect(light.key, "窗口开始前的旧用量不能算进新窗口").toBe("w5ho");

    // 新窗口里用到 90：还在窗口开头这不满一小时里，也必须算数。
    await setHourBucket(key.id, thisHour, 150);
    const heavy = await call(pool, "guest1");
    expect(heavy.key, "窗口开头不满一小时的用量要计入，借用者到 85% 让出").toBe("w5hf");

    report.window5h = {
      baseCredits: Number(afterAnchor.five_hour_window_base_credits),
      keyAt30Percent: light.key,
      keyAt90Percent: heavy.key,
    };
  });

  test("周窗口：默认跟随套餐的周重置时间，Key 自己从上游学到的时刻优先", async () => {
    const pool = "weekly";
    const key = await credentialRow(pool, "wkyo");
    const token = await adminToken();
    const headers = { Authorization: `Bearer ${token}` };
    const WEEK_MS = 7 * 24 * HOUR_MS;

    type CredentialView = {
      id: number;
      weeklyCredits: number;
      nextWeeklyResetAt: string;
      weeklyResetEstimated: boolean;
    };
    const listCredentials = async (): Promise<Map<string, CredentialView>> => {
      const res = await api.get(`/api/admin/credentials?productLineId=${lineId(pool)}`, { headers });
      const rows = ((await res.json()) as { data: Array<CredentialView & { label: string }> }).data;
      return new Map(rows.map((row) => [row.label.replace(/^调度-/, ""), row]));
    };

    // 3 小时前这把 Key 用掉了 96 积分（周额度 100，借用线 95%）。
    await setHourBucket(key.id, hourStartOf(minutesAgo(3 * 60)), 96);

    const before = await listCredentials();
    expect(before.get("wkyf")?.weeklyResetEstimated, "套餐没录入时周重置时间只是估算").toBe(true);

    // 这把 Key 之前从上游学到：本周窗口 5 小时前开始 → 那 96 积分在本周内，借用者不能用。
    await sql`
      update upstream_credentials
      set weekly_window_reset_at = ${new Date(Date.now() - 5 * HOUR_MS + WEEK_MS)}
      where id = ${key.id}
    `;
    const blocked = await call(pool, "guest1");
    expect(blocked.key, "周额度已到借用线的 Key 不借").toBe("wkyf");

    // 管理员在套餐上录入周重置时间：本周窗口 1 小时前才开始 → 那 96 积分属于上一周。
    const lineReset = new Date(Math.floor((Date.now() - HOUR_MS + WEEK_MS) / 1_000) * 1_000);
    const linesRes = await api.get("/api/admin/product-lines", { headers });
    const line = ((await linesRes.json()) as { data: Array<{ id: number; configVersion: number }> }).data
      .find((row) => row.id === lineId(pool));
    expect(line, "应能读到调度周窗口渠道").toBeTruthy();
    const patched = await api.patch(`/api/admin/product-lines/${lineId(pool)}`, {
      headers,
      data: { expectedConfigVersion: line!.configVersion, weeklyWindowResetAt: lineReset.toISOString() },
    });
    expect(patched.status(), `保存套餐周重置时间失败: ${await patched.text()}`).toBe(200);

    const [afterSave] = await sql<Array<{ weekly_window_reset_at: Date | null }>>`
      select weekly_window_reset_at from upstream_credentials where id = ${key.id}
    `;
    expect(afterSave.weekly_window_reset_at, "套餐时间更新后，Key 上学到的旧时刻要清掉").toBeNull();

    const followsLine = await listCredentials();
    expect(followsLine.get("wkyo")?.weeklyCredits, "那 96 积分不在套餐的本周窗口里").toBe(0);
    expect(followsLine.get("wkyo")?.weeklyResetEstimated).toBe(false);
    expect(new Date(followsLine.get("wkyf")!.nextWeeklyResetAt).getTime(), "没学到相位的 Key 跟随套餐").toBe(
      lineReset.getTime(),
    );
    const allowed = await call(pool, "guest2");
    expect(allowed.key, "按套餐的周窗口算，这把 Key 本周还没用").toBe("wkyo");

    // 这把 Key 真撞到上游周限额：回包里的重置时刻只覆盖这把 Key。
    const keyReset = new Date(Math.floor((Date.now() + 2 * 24 * HOUR_MS) / 1_000) * 1_000);
    await setBehavior(pool, "wkyo", { type: "status", status: 429, body: weeklyCapBody(keyReset) });
    const capped = await call(pool, "guest2");
    expect(capped.status).toBe(200);
    expect(await hitsFor(pool, capped.marker)).toEqual(["wkyo", "wkyf"]);

    const learned = await listCredentials();
    expect(
      new Date(learned.get("wkyo")!.nextWeeklyResetAt).getTime(),
      "上游回包里的时刻优先于套餐默认值",
    ).toBe(keyReset.getTime());
    expect(new Date(learned.get("wkyf")!.nextWeeklyResetAt).getTime(), "其他 Key 仍跟随套餐").toBe(
      lineReset.getTime(),
    );
    const cooled = await credentialRow(pool, "wkyo");
    expect(cooled.status).toBe("cooling");
    expect(cooled.cool_until?.getTime(), "周限额冷却到上游给的重置时刻").toBe(keyReset.getTime());

    report.weekly = {
      blockedByKeyPhase: blocked.key,
      lineResetAt: lineReset.toISOString(),
      allowedByLinePhase: allowed.key,
      keyLearnedResetAt: keyReset.toISOString(),
      otherKeyFollowsLine: learned.get("wkyf")?.nextWeeklyResetAt,
    };
  });

  test("上游 429 按业务码分类：1313 停用并告警、1305 不冷却不换 Key、1308 最多换一次", async () => {
    const pool = "ratelimit";

    // 1313 公平使用风控。
    await setBehavior(pool, "rl01", { type: "status", status: 429, body: FAIR_USE_BODY });
    const fairUse = await call(pool, "guest1");
    expect(fairUse.status, "风控码直接把错误还给调用方").toBe(429);
    expect(await hitsFor(pool, fairUse.marker), "风控码不能换 Key 重放").toEqual(["rl01"]);
    const disabled = await credentialRow(pool, "rl01");
    expect(disabled.status, "被风控的 Key 停用，等管理员确认").toBe("auto_disabled");
    expect(disabled.last_failure_kind).toBe("fair_use");
    expect(disabled.last_vendor_code).toBe("1313");
    const alert = await waitFor("公平使用告警送达 webhook", async () => {
      const state = await mockState();
      return state.alerts
        .map((item) => (typeof item === "string" ? item : item.text?.content ?? ""))
        .find((content) => content.includes("公平使用") && content.includes("rl01"));
    });
    expect(alert, "告警应带上当时在用这把 Key 的人").toContain(SCHED_PEOPLE.guest1.name);

    // 1305 模型拥堵：和哪把 Key 无关。
    await setBehavior(pool, "rl02", { type: "status", status: 429, body: MODEL_BUSY_BODY });
    const modelBusy = await call(pool, "guest1");
    expect(modelBusy.status).toBe(429);
    expect(await hitsFor(pool, modelBusy.marker), "模型拥堵不换 Key").toEqual(["rl02"]);
    expect(Number(modelBusy.retryAfter), "模型拥堵应给一个短的 retry-after").toBeGreaterThan(0);
    expect(Number(modelBusy.retryAfter)).toBeLessThanOrEqual(30);
    const healthy = await credentialRow(pool, "rl02");
    expect(healthy.status, "模型拥堵不能冷却健康的 Key").toBe("active");
    expect(healthy.cool_until).toBeNull();
    expect(await boundKey(pool, "guest1"), "模型拥堵不改绑定").toBe("rl02");

    // 1308 额度用尽：换一次 Key。
    const resetAt = new Date(Date.now() + 2 * 3_600_000);
    await setBehavior(pool, "rl02", { type: "status", status: 429, body: fiveHourCapBody(resetAt) });
    const oneHop = await call(pool, "guest1");
    expect(oneHop.status).toBe(200);
    expect(await hitsFor(pool, oneHop.marker)).toEqual(["rl02", "rl03"]);
    expect((await credentialRow(pool, "rl02")).status).toBe("cooling");

    // 连续两把都额度用尽：换过一次后不再换，第三把健康的 Key 不能被扫到。
    await setBehavior(pool, "rl03", { type: "status", status: 429, body: fiveHourCapBody(resetAt) });
    await setBehavior(pool, "rl04", { type: "status", status: 429, body: fiveHourCapBody(resetAt) });
    const hopLimit = await call(pool, "guest1");
    expect(hopLimit.status, "换过一次仍限流就把 429 还给调用方").toBe(429);
    expect(await hitsFor(pool, hopLimit.marker), "限流类最多换 1 次 Key").toEqual(["rl03", "rl04"]);
    const untouched = (await mockState()).hits.filter(
      (hit) => hit.secret === schedSecret(pool, "rl05"),
    );
    expect(untouched, "第 5 把 Key 不应被这次请求扫到").toEqual([]);

    report.ratelimit = {
      fairUse: {
        hits: ["rl01"],
        status: disabled.status,
        failureKind: disabled.last_failure_kind,
        alert,
      },
      modelBusy: { hits: ["rl02"], keyStatus: healthy.status, retryAfter: modelBusy.retryAfter },
      usageCapOneHop: ["rl02", "rl03"],
      usageCapHopLimit: { hits: ["rl03", "rl04"], status: hopLimit.status },
    };
  });

  test("1311 套餐未开放模型：不冷却 Key，换一次 Key", async () => {
    const pool = "planDenied";
    await setBehavior(pool, "pd01", { type: "status", status: 429, body: PLAN_DENIED_BODY });
    const result = await call(pool, "guest1");
    expect(result.status).toBe(200);
    expect(await hitsFor(pool, result.marker)).toEqual(["pd01", "pd02"]);
    const denied = await credentialRow(pool, "pd01");
    expect(denied.status, "套餐权限问题不能冷却 Key").toBe("active");
    expect(denied.cool_until).toBeNull();
    report.planDenied = { hits: ["pd01", "pd02"], keyStatus: denied.status };
  });

  test("模型拥堵以 HTTP 529 返回时同样不换 Key、不动 Key 状态", async () => {
    const pool = "overload";
    await setBehavior(pool, "ov01", { type: "status", status: 529, body: MODEL_BUSY_BODY });
    const result = await call(pool, "guest1");
    expect(result.status, "模型拥堵统一按 429 还给调用方").toBe(429);
    expect(await hitsFor(pool, result.marker), "不能把拥堵的请求扫到别的 Key 上").toEqual(["ov01"]);
    expect(Number(result.retryAfter)).toBeGreaterThan(0);
    expect(Number(result.retryAfter)).toBeLessThanOrEqual(30);
    const key = await credentialRow(pool, "ov01");
    expect(key.status).toBe("active");
    expect(key.last_failure_kind, "模型拥堵不算这把 Key 的故障").toBeNull();
    expect(await boundKey(pool, "guest1")).toBe("ov01");
    report.overload = { hits: ["ov01"], status: result.status, retryAfter: result.retryAfter };
  });

  test("上游 5xx 仍按原来的次数换 Key 重试", async () => {
    const pool = "serverError";
    const failure = { type: "status", status: 500, body: { error: { message: "mock 500" } } } as const;
    await setBehavior(pool, "se01", failure);
    await setBehavior(pool, "se02", failure);
    const result = await call(pool, "guest1");
    expect(result.status, "两把 Key 故障后第三把成功").toBe(200);
    expect(await hitsFor(pool, result.marker)).toEqual(["se01", "se02", "se03"]);
    expect((await credentialRow(pool, "se01")).status, "5xx 不改 Key 状态").toBe("active");
    report.serverError = { hits: ["se01", "se02", "se03"] };
  });

  test("成员 30 分钟没调用就释放；最后一人走后 Key 回池", async () => {
    const pool = "idle";
    const poolKey = `line:${lineId(pool)}`;
    expect((await call(pool, "ownerIdle")).key).toBe("idlo");
    expect((await call(pool, "guest1")).key).toBe("idlo");
    expect(await membersByKey(pool)).toEqual({ idlo: ["guest1", "ownerIdle"] });

    const backdate = async (person: SchedPersonKey) => {
      await sql`
        update credential_binding_members
        set last_used_at = ${minutesAgo(31)}, created_at = ${minutesAgo(31)}
        where employee_id = ${employeeId(person)} and relay_pool_key = ${poolKey}
      `;
    };

    // 借用者 31 分钟没调用：只释放他，主人还在。
    await backdate("guest1");
    await waitFor("闲置成员被释放", async () => (await boundKey(pool, "guest1")) === null);
    // 再等过至少一轮清理，确认还在用的成员没被误释放。
    await new Promise((done) => setTimeout(done, 2_500));
    expect(await membersByKey(pool), "还在用的成员不能被释放").toEqual({ idlo: ["ownerIdle"] });
    expect(await bindingExists(pool, "idlo"), "还有成员时绑定保留").toBe(true);

    // 最后一人也闲置：Key 回到待绑定池。
    await backdate("ownerIdle");
    const credential = await credentialRow(pool, "idlo");
    await sql`
      update credential_bindings
      set updated_at = ${minutesAgo(31)}
      where credential_id = ${credential.id}
    `;
    await waitFor("最后一人释放后绑定清空", async () => !(await bindingExists(pool, "idlo")));
    expect(await membersByKey(pool)).toEqual({});

    // 回池后还能重新绑定。
    expect((await call(pool, "guest1")).key).toBe("idlo");
    report.idle = { releasedGuestOnly: ["ownerIdle"], keyReturnedToPool: true };
  });

  test("企业隔离：别的企业员工名下的 Key 不能借", async () => {
    const pool = "isolation";
    const outsider = await call(pool, "outsider");
    expect(outsider.key, "外部企业的人用自己名下的 Key").toBe("isox");
    const guest = await call(pool, "guest1");
    expect(guest.key).toBe("isoo");

    await setCredentialStatus(pool, "isoo", "disabled");
    const blocked = await call(pool, "guest1");
    expect(blocked.status, "不能借外部企业员工名下的 Key").toBe(503);
    expect(await hitsFor(pool, blocked.marker)).toEqual([]);
    await setCredentialStatus(pool, "isoo", "active");

    await setCredentialStatus(pool, "isox", "disabled");
    const outsiderBlocked = await call(pool, "outsider");
    expect(outsiderBlocked.status, "外部企业的人也不能借本企业员工名下的 Key").toBe(503);
    expect(await hitsFor(pool, outsiderBlocked.marker)).toEqual([]);
    await setCredentialStatus(pool, "isox", "active");

    report.isolation = {
      outsider: outsider.key,
      guest: guest.key,
      guestBlockedStatus: blocked.status,
      outsiderBlockedStatus: outsiderBlocked.status,
    };
  });

  test("充值模式的 Key 没有主人：都能用，但一把 Key 不同时挂两家企业的人", async () => {
    const pool = "recharge";
    const first = await call(pool, "outsider");
    expect(first.key, "没有主人的 Key 谁都能用，同分取 ID 小的").toBe("rc01");
    const second = await call(pool, "guest1");
    expect(second.key, "已被另一家企业占用的 Key 不能再挂进去").toBe("rc02");
    const members = await membersByKey(pool);
    expect(members).toEqual({ rc01: ["outsider"], rc02: ["guest1"] });
    report.recharge = { outsider: first.key, guest: second.key, members };
  });

  test("主人的 Key 冷却期间借别人的，冷却结束后回到自己的 Key", async () => {
    const pool = "homing";
    expect((await call(pool, "ownerHome")).key).toBe("homo");

    const resetAt = new Date(Date.now() + 2 * 3_600_000);
    await setBehavior(pool, "homo", { type: "status", status: 429, body: fiveHourCapBody(resetAt) });
    const displaced = await call(pool, "ownerHome");
    expect(displaced.key, "自己的 Key 撞限额后换到别的 Key").toBe("homf");
    expect(await boundKey(pool, "ownerHome")).toBe("homf");

    const whileCooling = await call(pool, "ownerHome");
    expect(whileCooling.key, "冷却期间留在借来的 Key 上").toBe("homf");
    expect(await hitsFor(pool, whileCooling.marker), "冷却中的 Key 不能再被打到").toEqual(["homf"]);

    // 冷却到期。
    await setBehavior(pool, "homo", { type: "ok" });
    const credential = await credentialRow(pool, "homo");
    await sql`
      update upstream_credentials set cool_until = ${minutesAgo(1)}
      where id = ${credential.id}
    `;
    const home = await call(pool, "ownerHome");
    expect(home.key, "冷却结束后回到自己的 Key").toBe("homo");
    expect(await boundKey(pool, "ownerHome")).toBe("homo");

    report.homing = {
      displacedTo: displaced.key,
      whileCooling: whileCooling.key,
      afterCooling: home.key,
    };
  });
});
