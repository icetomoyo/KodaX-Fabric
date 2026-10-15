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
import { isolateChannelPool } from "./pool-isolation.ts";
import {
  SCHED_MODEL,
  SCHED_PEOPLE,
  SCHED_POOLS,
  SCHED_UI_PACKAGE,
  schedApiKey,
  schedLineCode,
  schedSecret,
  type SchedPersonKey,
  type SchedPoolKey,
} from "./scheduling-fixture.ts";

/**
 * 渠道 Key 调度 E2E：亲和度选 Key、每把 Key 最多 3 人 / 9 并发 / 单人 3 路、按成员 30 分钟
 * 释放、席位主人保护、上游 429 按业务码分类处理。
 *
 * 全程走真实 HTTP 进真实 server，上游是本机可编排的 mock（按 Bearer 认 Key、
 * 回显是哪把 Key 应答）。每个场景一条智谱套餐，开跑前只启用这一条，独占智谱的调度池。
 * 夹具见 seed-scheduling.ts，全是刚注册的新账号：旧逻辑下新账号 7 天内独占一把 Key，
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
 *  9. 一把 Key 同时在途超过 9 个请求，或同一人在一把 Key 上超过 3 路。
 * 10. 借用者第 4 路并发去换 Key，而不是 429 且保持原绑定。
 * 11. 主人第 4 路并发溢出到别的 Key，而不是 429 且保持原绑定。
 * 12. 三人各 3 路打满后新请求挂住或报 5xx，而不是立刻 429 带 retry-after。
 * 13. 借用者或主人在本地估算到 85%/100% 时被本地拦下换 Key，而不是都用到上游真的限额。
 * 14. 上游返回 5 小时额度用尽（1308）后没有冷却到重置时刻；或者池里还有能用的 Key，
 *     请求却因为「限流只换一次 Key」而失败（员工白白失败一次）。
 * 15. 上游返回公平使用风控（1313）后 Key 没停用、没有告警；或者这次请求没有换 Key 重发，
 *     直接把失败甩给了员工。
 * 16. 上游模型拥堵（1305）连带冷却了健康的 Key，或者请求在多把 Key 上连扫。
 * 16b. 模型拥堵以 HTTP 529 返回时（线上 1305 多数是 529）被当成普通 5xx，在多把 Key 上连扫。
 * 17. 上游说模型未开放（1311，多半是调用方把模型名写错了）时：冷却了 Key；或者换 Key
 *     去别的 Key 上再试；或者按限流回 429 让客户端反复重试，而不是明确告诉调用方模型不支持。
 * 18. 上游 5xx 时不再换 Key 重试（限流的换 Key 上限误伤了故障重试）。
 * 19. 30 分钟没调用的成员没有被释放；还在用的成员被误释放；最后一人走后 Key 没回池。
 * 20. 管理端画布上的「谁在用哪把 Key」和库里的实际绑定对不上。
 * 21. 5 小时窗口开头不满一小时的用量没有计入（账本按整点分桶）；
 *     或者把同一小时里、窗口开始之前的旧用量也算了进来。
 * 22. 上游 1308 回包给的重置时刻说明窗口比本地记的开始得早，本地窗口起点却没被改正。
 * 23. 没学到自己重置时刻的 Key，周窗口没有跟随套餐上录入的周重置时间。
 * 24. 某把 Key 从上游 1310 回包学到的重置时刻，没有覆盖套餐的默认值。
 * 25. 管理员改了套餐的周重置时间后，Key 上以前学到的旧时刻还在生效。
 * 26. 套餐上设了积分上限，套餐下的 Key 显示/计算的仍是不限额。
 * 27. 渠道 Key 还能单独设置上限，积分上限出现两处来源。
 * 28. 在套餐上改了上限后，没有立即对套餐下所有 Key 生效。
 * 29. 管理端显示的上限不是实际生效的上限。
 * 30. 「编辑产品」对话框里填的积分上限没有真正保存，或者保存后重新打开看不到。
 * 31. 所有 Key 都限流、请求最终失败时，retry-after 不是真实的恢复时间（以前固定 5 分钟）。
 * 32. 试满尝试次数而池里还有别的 Key 时，retry-after 仍是 5 分钟，客户端白等。
 * 33. 套餐到期 / 失效（1309、1314、1315）的 Key 只是冷却，到点又被选中再失败一次，
 *     而不是停用并告警；或者这次请求没有换 Key 重发。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");
const MODEL = SCHED_MODEL;

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

let restorePool: (() => Promise<void>) | null = null;

/** 只启用这个场景的套餐、清掉智谱池里的绑定，用例结束后放回原样。 */
async function usePool<P extends SchedPoolKey>(pool: P): Promise<P> {
  restorePool = await isolateChannelPool(sql, "glm", [lineId(pool)]);
  return pool;
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
  const res = await api.post("/v1/chat/completions", {
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
const PLAN_EXPIRED_BODY = {
  error: {
    code: "1309",
    message: "您的 GLM Coding Plan 套餐已到期，暂无法使用，前往官方续订后即可恢复 https://bigmodel.cn/claude-code",
  },
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
      select id, code from product_lines where code like 'cn_sched_%'
    `;
    for (const pool of Object.keys(SCHED_POOLS) as SchedPoolKey[]) {
      const row = lines.find((line) => line.code === schedLineCode(pool));
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

  test.afterEach(async () => {
    await restorePool?.();
    restorePool = null;
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
    const pool = await usePool("affinity");
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
    const pool = await usePool("capacity");

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

  test("每把 Key 最多 9 并发、单人 3 路：超额 429 且不解绑", async () => {
    const pool = await usePool("burst");
    await setBehavior(pool, "bsto", { type: "hold" });
    await setBehavior(pool, "bstf", { type: "hold" });
    const pending: Array<Promise<CallResult>> = [];

    pending.push(call(pool, "ownerBurst"), call(pool, "guest1"), call(pool, "guest2"));
    await waitForInFlight(pool, { bsto: 3 });
    expect(await boundKey(pool, "guest2")).toBe("bsto");

    pending.push(call(pool, "guest2"), call(pool, "guest2"));
    await waitForInFlight(pool, { bsto: 5 });
    expect(await boundKey(pool, "guest2"), "个人未满 3 路时仍留在原 Key").toBe("bsto");

    const guestOver = await call(pool, "guest2");
    expect(guestOver.status, "借用者第 4 路立刻 429").toBe(429);
    expect(guestOver.code).toBe("employee_concurrency_limit");
    expect(Number(guestOver.retryAfter), "429 应带 retry-after").toBeGreaterThan(0);
    expect(await hitsFor(pool, guestOver.marker), "个人超额不应再打上游").toEqual([]);
    expect(await boundKey(pool, "guest2"), "借用者超额不解绑").toBe("bsto");
    expect(await boundKey(pool, "guest1"), "没发新请求的借用者不受影响").toBe("bsto");

    pending.push(call(pool, "ownerBurst"), call(pool, "ownerBurst"));
    await waitForInFlight(pool, { bsto: 7 });
    const ownerOver = await call(pool, "ownerBurst");
    expect(ownerOver.status, "主人第 4 路立刻 429").toBe(429);
    expect(ownerOver.code).toBe("employee_concurrency_limit");
    expect(await boundKey(pool, "ownerBurst"), "主人超额不解绑、不溢出").toBe("bsto");

    pending.push(call(pool, "guest1"), call(pool, "guest1"));
    await waitForInFlight(pool, { bsto: 9 });
    const full = await call(pool, "guest1");
    expect(full.status, "三人各 3 路打满后立刻 429").toBe(429);
    expect(Number(full.retryAfter)).toBeGreaterThan(0);
    expect(await boundKey(pool, "guest1"), "打满后仍留在原 Key").toBe("bsto");
    expect((await mockState()).inFlight[schedSecret(pool, "bstf")] ?? 0, "并发超额不应换到第二把 Key").toBe(0);

    await setBehavior(pool, "bsto", { type: "ok" });
    await setBehavior(pool, "bstf", { type: "ok" });
    await mockControl("release", {});
    const results = await Promise.all(pending);
    expect(results.map((result) => result.status), "挂起的请求全部正常完成").toEqual(
      results.map(() => 200),
    );
    const served = { bsto: 0, bstf: 0 } as Record<string, number>;
    for (const result of results) served[result.key ?? "none"] = (served[result.key ?? "none"] ?? 0) + 1;
    expect(served).toEqual({ bsto: 9, bstf: 0 });

    const state = await mockState();
    const maxInFlight = {
      bsto: state.maxInFlight[schedSecret(pool, "bsto")] ?? 0,
      bstf: state.maxInFlight[schedSecret(pool, "bstf")] ?? 0,
    };
    expect(maxInFlight, "任何时刻单把 Key 在途都不超过 9").toEqual({ bsto: 9, bstf: 0 });

    report.burst = {
      served,
      maxInFlight,
      guestOver: { status: guestOver.status, code: guestOver.code, retryAfter: guestOver.retryAfter },
      ownerOver: { status: ownerOver.status, code: ownerOver.code, retryAfter: ownerOver.retryAfter },
      full: { status: full.status, code: full.code, retryAfter: full.retryAfter },
      finalBindings: await membersByKey(pool),
    };
  });

  test("借用者和主人都用到上游真的限额；1308 冷却到重置时刻并换 Key 完成请求", async () => {
    const pool = await usePool("quota");
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

    const guestAt90 = await call(pool, "guest1");
    expect(guestAt90.key, "本地估算到 90% 也不拦借用者，以上游为准").toBe("qtao");
    const ownerAt90 = await call(pool, "ownerQuota");
    expect(ownerAt90.key, "本地估算到 90% 也不拦主人，以上游为准").toBe("qtao");

    await setUsage(100);
    const guestAt100 = await call(pool, "guest1");
    expect(guestAt100.key, "本地估算到 100% 也不拦借用者，以上游为准").toBe("qtao");
    const ownerAt100 = await call(pool, "ownerQuota");
    expect(ownerAt100.key, "本地估算到 100% 也不拦主人，以上游为准").toBe("qtao");

    // 上游真的返回 5 小时额度用尽。
    const resetAt = new Date(Date.now() + 2 * 3_600_000);
    await setBehavior(pool, "qtao", { type: "status", status: 429, body: fiveHourCapBody(resetAt) });
    const capped = await call(pool, "ownerQuota");
    expect(capped.status, "撞到上游限额后换 Key 完成请求").toBe(200);
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
      guestBefore: guestBefore.key,
      guestAt90: guestAt90.key,
      ownerAt90: ownerAt90.key,
      guestAt100: guestAt100.key,
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
    const pool = await usePool("window5h");
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

    // 新窗口里用到 90：还在窗口开头这不满一小时里，也必须算数（本地不再按 85% 让出）。
    await setHourBucket(key.id, thisHour, 150);
    const token = await adminToken();
    const credsRes = await api.get(`/api/admin/credentials?productLineId=${lineId(pool)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const creds = ((await credsRes.json()) as {
      data: Array<{ label: string; fiveHourCredits: number }>;
    }).data;
    const ownerUsage = creds.find((row) => row.label.replace(/^调度-/, "") === "w5ho");
    expect(ownerUsage?.fiveHourCredits, "窗口开头不满一小时的用量要计入").toBe(90);
    const heavy = await call(pool, "guest1");
    expect(heavy.key, "本地估算到 90% 也不拦借用者，以上游为准").toBe("w5ho");

    report.window5h = {
      baseCredits: Number(afterAnchor.five_hour_window_base_credits),
      keyAt30Percent: light.key,
      creditsAt90Percent: ownerUsage?.fiveHourCredits,
      keyAt90Percent: heavy.key,
    };
  });

  test("周窗口：默认跟随套餐的周重置时间，Key 自己从上游学到的时刻优先", async () => {
    const pool = await usePool("weekly");
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

    // 3 小时前这把 Key 用掉了 96 积分（周额度 100）。
    await setHourBucket(key.id, hourStartOf(minutesAgo(3 * 60)), 96);

    const before = await listCredentials();
    expect(before.get("wkyf")?.weeklyResetEstimated, "套餐没录入时周重置时间只是估算").toBe(true);

    // 这把 Key 之前从上游学到：本周窗口 5 小时前开始 → 那 96 积分按 Key 自己的相位算在本周内。
    await sql`
      update upstream_credentials
      set weekly_window_reset_at = ${new Date(Date.now() - 5 * HOUR_MS + WEEK_MS)}
      where id = ${key.id}
    `;
    const byKeyPhase = await listCredentials();
    expect(byKeyPhase.get("wkyo")?.weeklyCredits, "按 Key 自己的周相位，96 积分在本周内").toBe(96);
    const affinity = await call(pool, "guest1");
    expect(affinity.key, "本地不因周用量让出，按亲和度仍用这把 Key").toBe("wkyo");
    // 这次 glm-5.3 调用按真实系数计了积分，记在当前小时。
    const callCredits = (await listCredentials()).get("wkyo")!.weeklyCredits - 96;
    expect(callCredits, "调用应计入这把 Key 的账本").toBeGreaterThan(0);

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
    expect(followsLine.get("wkyo")?.weeklyCredits, "那 96 积分不在套餐的本周窗口里，只剩刚才那次调用")
      .toBeCloseTo(callCredits, 4);
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
      weeklyCreditsByKeyPhase: byKeyPhase.get("wkyo")?.weeklyCredits,
      affinityByKeyPhase: affinity.key,
      lineResetAt: lineReset.toISOString(),
      allowedByLinePhase: allowed.key,
      keyLearnedResetAt: keyReset.toISOString(),
      otherKeyFollowsLine: learned.get("wkyf")?.nextWeeklyResetAt,
    };
  });

  test("积分上限只在套餐上设置，对套餐下所有 Key 立即生效", async () => {
    const pool = await usePool("limits");
    await waitOutHourBoundary();
    const key = await credentialRow(pool, "lmto");
    const headers = { Authorization: `Bearer ${await adminToken()}` };

    type LimitView = {
      label: string;
      fiveHourCreditLimit: number | null;
      weeklyCreditLimit: number | null;
    };
    const limitsByKey = async (): Promise<Record<string, Array<number | null>>> => {
      const res = await api.get(`/api/admin/credentials?productLineId=${lineId(pool)}`, { headers });
      const rows = ((await res.json()) as { data: LimitView[] }).data;
      return Object.fromEntries(
        rows.map((row) => [
          row.label.replace(/^调度-/, ""),
          [row.fiveHourCreditLimit, row.weeklyCreditLimit],
        ]),
      );
    };
    const setPackageLimits = async (limits: Record<string, number | null>) => {
      const linesRes = await api.get("/api/admin/product-lines", { headers });
      const line = ((await linesRes.json()) as { data: Array<{ id: number; configVersion: number }> })
        .data.find((row) => row.id === lineId(pool));
      const res = await api.patch(`/api/admin/product-lines/${lineId(pool)}`, {
        headers,
        data: { expectedConfigVersion: line!.configVersion, ...limits },
      });
      expect(res.status(), `保存套餐积分上限失败: ${await res.text()}`).toBe(200);
    };

    // 这把 Key 当前 5 小时窗口里已经用了 90 积分。
    const thisHour = hourStartOf(new Date());
    await sql`
      update upstream_credentials set five_hour_window_anchor = ${thisHour} where id = ${key.id}
    `;
    await setHourBucket(key.id, thisHour, 90);

    // 套餐没设上限：不限额。
    expect(await limitsByKey()).toEqual({ lmto: [null, null], lmtf: [null, null] });
    const unlimited = await call(pool, "guest1");
    expect(unlimited.key, "没有上限时按亲和度用这把 Key").toBe("lmto");

    // 在套餐上设上限：套餐下每把 Key 立即按它显示；90 / 100 也不再本地让出。
    await setPackageLimits({ fiveHourCreditLimit: 100, weeklyCreditLimit: 1000 });
    expect(await limitsByKey(), "套餐下每把 Key 都显示套餐的上限").toEqual({
      lmto: [100, 1000],
      lmtf: [100, 1000],
    });
    const limited = await call(pool, "guest1");
    expect(limited.key, "设了上限也不按本地用量让出").toBe("lmto");

    // 渠道 Key 不能再单独设置上限。
    const perKey = await api.patch(`/api/admin/credentials/${key.id}`, {
      headers,
      data: { fiveHourCreditLimit: 1000 },
    });
    expect(perKey.status(), "渠道 Key 的接口不再接受积分上限").toBe(400);
    expect((await limitsByKey()).lmto, "被拒绝的请求不改变任何东西").toEqual([100, 1000]);

    // 调高 / 调低套餐上限：立刻反映在套餐下每把 Key 的显示上。
    await setPackageLimits({ fiveHourCreditLimit: 1000 });
    const afterRaise = await limitsByKey();
    expect(afterRaise, "调高后立即显示").toEqual({ lmto: [1000, 1000], lmtf: [1000, 1000] });

    await setPackageLimits({ fiveHourCreditLimit: 105 });
    const afterLower = await limitsByKey();
    expect(afterLower, "调低后立即显示").toEqual({ lmto: [105, 1000], lmtf: [105, 1000] });

    // 清空表示不限。
    await setPackageLimits({ fiveHourCreditLimit: null, weeklyCreditLimit: null });
    expect(await limitsByKey()).toEqual({ lmto: [null, null], lmtf: [null, null] });

    report.limits = {
      unlimited: unlimited.key,
      afterPackageLimit: limited.key,
      perKeyUpdateStatus: perKey.status(),
      afterRaise,
      afterLower,
    };
  });

  test("在「编辑产品」对话框里统一设置积分上限", async ({ page }) => {
    const headers = { Authorization: `Bearer ${await adminToken()}` };
    const [line] = await sql<Array<{ id: string }>>`
      select id from product_lines where code = ${SCHED_UI_PACKAGE.code}
    `;
    const uiLineId = Number(line.id);
    const keyLimits = async () => {
      const res = await api.get(`/api/admin/credentials?productLineId=${uiLineId}`, { headers });
      const rows = ((await res.json()) as {
        data: Array<{
          label: string;
          fiveHourCreditLimit: number | null;
          weeklyCreditLimit: number | null;
        }>;
      }).data;
      return Object.fromEntries(
        rows.map((row) => [
          row.label.replace(/^调度-/, ""),
          [row.fiveHourCreditLimit, row.weeklyCreditLimit],
        ]),
      );
    };
    expect(await keyLimits(), "保存前：套餐没设上限").toEqual({
      uik1: [null, null],
      uik2: [null, null],
    });

    // 管理员登录 → 渠道管理 → 智谱 → 套餐的「编辑」。
    await page.goto("/");
    await page.getByText("账户登录", { exact: true }).click();
    await page.getByPlaceholder("11 位手机号").fill(E2E.admin.phone);
    await page.getByPlaceholder("请输入密码").fill(E2E.admin.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
    await page.goto("/admin/temp-channels");
    await page.locator(".item-card", { hasText: SCHED_UI_PACKAGE.channelName }).first().click();
    const packageCard = page.locator(".item-card", { hasText: SCHED_UI_PACKAGE.name });
    await expect(packageCard).toBeVisible({ timeout: 15_000 });

    const openDialog = async () => {
      await packageCard.getByRole("button", { name: "编辑" }).click();
      const dialog = page.locator(".el-dialog", { hasText: "编辑产品" });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const fiveHourPlaceholder = "每把 KEY 的 5 小时上限，例如 35000";
    const weeklyPlaceholder = "每把 KEY 的每周上限，例如 155000";

    const dialog = await openDialog();
    await dialog.getByPlaceholder(fiveHourPlaceholder).fill("35000");
    await dialog.getByPlaceholder(weeklyPlaceholder).fill("155000");
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await dialog.screenshot({ path: resolve(ARTIFACT_DIR, "package-credit-limits.png") });
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("产品已更新")).toBeVisible();

    const afterSave = await keyLimits();
    expect(afterSave, "保存后该产品下所有 KEY 统一使用套餐的上限").toEqual({
      uik1: [35000, 155000],
      uik2: [35000, 155000],
    });

    // 重新打开能看到刚保存的值。
    const reopened = await openDialog();
    await expect(reopened.getByPlaceholder(fiveHourPlaceholder)).toHaveValue("35000");
    await expect(reopened.getByPlaceholder(weeklyPlaceholder)).toHaveValue("155000");

    report.packageLimitDialog = { afterSave, screenshot: "package-credit-limits.png" };
  });

  test("上游 429 按业务码分类：1313 停用告警并换 Key、1305 不冷却不换 Key、1308 一直换到有 Key 能用", async () => {
    const pool = await usePool("ratelimit");

    // 1313 公平使用风控：Key 停用、告警，这次请求换一把 Key 完成。
    await setBehavior(pool, "rl01", { type: "status", status: 429, body: FAIR_USE_BODY });
    const fairUse = await call(pool, "guest1");
    expect(fairUse.status, "撞到风控的请求换一把 Key 完成，不把失败甩给员工").toBe(200);
    expect(await hitsFor(pool, fairUse.marker)).toEqual(["rl01", "rl02"]);
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

    // 1308 额度用尽：换 Key。
    const resetAt = new Date(Date.now() + 2 * 3_600_000);
    await setBehavior(pool, "rl02", { type: "status", status: 429, body: fiveHourCapBody(resetAt) });
    const oneHop = await call(pool, "guest1");
    expect(oneHop.status).toBe(200);
    expect(await hitsFor(pool, oneHop.marker)).toEqual(["rl02", "rl03"]);
    expect((await credentialRow(pool, "rl02")).status).toBe("cooling");

    // 连续两把都额度用尽：继续换，直到有 Key 能用。
    await setBehavior(pool, "rl03", { type: "status", status: 429, body: fiveHourCapBody(resetAt) });
    await setBehavior(pool, "rl04", { type: "status", status: 429, body: fiveHourCapBody(resetAt) });
    const twoHops = await call(pool, "guest1");
    expect(twoHops.status, "池里还有能用的 Key 时请求不应失败").toBe(200);
    expect(await hitsFor(pool, twoHops.marker)).toEqual(["rl03", "rl04", "rl05"]);

    // 最后一把也额度用尽：池子真的空了，retry-after 给出真实的恢复时间（约 2 小时后）。
    await setBehavior(pool, "rl05", { type: "status", status: 429, body: fiveHourCapBody(resetAt) });
    const exhausted = await call(pool, "guest1");
    expect(exhausted.status, "所有 Key 都限流时才把 429 还给调用方").toBe(429);
    expect(await hitsFor(pool, exhausted.marker)).toEqual(["rl05"]);
    const secondsToReset = (resetAt.getTime() - Date.now()) / 1_000;
    expect(Number(exhausted.retryAfter), "retry-after 应是最早恢复的那把 Key 的冷却剩余时间")
      .toBeGreaterThan(secondsToReset - 60);
    expect(Number(exhausted.retryAfter)).toBeLessThanOrEqual(2 * 3_600);

    report.ratelimit = {
      fairUse: {
        hits: ["rl01", "rl02"],
        requestStatus: fairUse.status,
        keyStatus: disabled.status,
        failureKind: disabled.last_failure_kind,
        alert,
      },
      modelBusy: { hits: ["rl02"], keyStatus: healthy.status, retryAfter: modelBusy.retryAfter },
      usageCapOneHop: ["rl02", "rl03"],
      usageCapTwoHops: { hits: ["rl03", "rl04", "rl05"], status: twoHops.status },
      poolExhausted: { status: exhausted.status, retryAfter: exhausted.retryAfter },
    };
  });

  test("试满尝试次数而池里还有 Key：429 的 retry-after 很短，重试就能换到别的 Key", async () => {
    const pool = await usePool("attempts");
    const resetAt = new Date(Date.now() + 2 * 3_600_000);
    for (const label of ["at01", "at02", "at03", "at04", "at05"]) {
      await setBehavior(pool, label, { type: "status", status: 429, body: fiveHourCapBody(resetAt) });
    }
    const failed = await call(pool, "guest1");
    expect(failed.status, "5 次尝试都限流").toBe(429);
    expect(await hitsFor(pool, failed.marker)).toEqual(["at01", "at02", "at03", "at04", "at05"]);
    expect(Number(failed.retryAfter), "池里还有 Key 时不该让客户端等 5 分钟").toBeGreaterThan(0);
    expect(Number(failed.retryAfter)).toBeLessThanOrEqual(5);

    const retried = await call(pool, "guest1");
    expect(retried.status, "客户端重试即可成功").toBe(200);
    expect(retried.key).toBe("at06");

    report.attemptsExhausted = {
      hits: 5,
      retryAfter: failed.retryAfter,
      retryStatus: retried.status,
      retryKey: retried.key,
    };
  });

  test("套餐到期（1309）：Key 停用并告警，这次请求换 Key 完成", async () => {
    const pool = await usePool("planExpired");
    await setBehavior(pool, "ex01", { type: "status", status: 429, body: PLAN_EXPIRED_BODY });
    const result = await call(pool, "guest1");
    expect(result.status, "套餐到期的 Key 不能让员工的请求失败").toBe(200);
    expect(await hitsFor(pool, result.marker)).toEqual(["ex01", "ex02"]);
    const expired = await credentialRow(pool, "ex01");
    expect(expired.status, "到期的 Key 停用，不再到点恢复后又被选中").toBe("auto_disabled");
    expect(expired.cool_until, "停用而不是冷却").toBeNull();
    expect(expired.last_failure_kind).toBe("plan_expired");
    expect(expired.last_vendor_code).toBe("1309");
    const alert = await waitFor("套餐到期告警送达 webhook", async () => {
      const state = await mockState();
      return state.alerts
        .map((item) => (typeof item === "string" ? item : item.text?.content ?? ""))
        .find((content) => content.includes("到期") && content.includes("ex01"));
    });

    const next = await call(pool, "guest1");
    expect(next.status).toBe(200);
    expect(await hitsFor(pool, next.marker), "停用后不再打到期的 Key").toEqual(["ex02"]);

    report.planExpired = {
      hits: ["ex01", "ex02"],
      keyStatus: expired.status,
      failureKind: expired.last_failure_kind,
      alert,
    };
  });

  test("1311 模型未开放：不换 Key、不冷却，明确告诉调用方模型不支持", async () => {
    const pool = await usePool("planDenied");
    await setBehavior(pool, "pd01", { type: "status", status: 429, body: PLAN_DENIED_BODY });
    const result = await call(pool, "guest1");
    expect(result.status, "模型名不对不是限流，不能回 429 让客户端一直重试").toBe(404);
    expect(result.code).toBe("model_not_found");
    expect(result.retryAfter, "不该带 retry-after").toBeNull();
    expect(await hitsFor(pool, result.marker), "换哪把 Key 都一样，不换").toEqual(["pd01"]);
    const denied = await credentialRow(pool, "pd01");
    expect(denied.status, "模型名的问题不能冷却 Key").toBe("active");
    expect(denied.cool_until).toBeNull();
    expect(await boundKey(pool, "guest1"), "不改绑定").toBe("pd01");
    const [audit] = await sql<Array<{ status: string }>>`
      select status from request_audits
      where employee_id = ${employeeId("guest1")} and product_line_id = ${lineId(pool)}
      order by id desc limit 1
    `;
    expect(audit.status, "记为调用方的请求错误，不算上游故障").toBe("client_error");
    report.planDenied = {
      hits: ["pd01"],
      status: result.status,
      code: result.code,
      keyStatus: denied.status,
      auditStatus: audit.status,
    };
  });

  test("模型拥堵以 HTTP 529 返回时同样不换 Key、不动 Key 状态", async () => {
    const pool = await usePool("overload");
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
    const pool = await usePool("serverError");
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
    const pool = await usePool("idle");
    const [poolRow] = await sql<Array<{ relay_pool_key: string }>>`
      select relay_pool_key from product_lines where id = ${lineId(pool)}
    `;
    const poolKey = poolRow.relay_pool_key;
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
    const pool = await usePool("isolation");
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
    const pool = await usePool("recharge");
    const first = await call(pool, "outsider");
    expect(first.key, "没有主人的 Key 谁都能用，同分取 ID 小的").toBe("rc01");
    const second = await call(pool, "guest1");
    expect(second.key, "已被另一家企业占用的 Key 不能再挂进去").toBe("rc02");
    const members = await membersByKey(pool);
    expect(members).toEqual({ rc01: ["outsider"], rc02: ["guest1"] });
    report.recharge = { outsider: first.key, guest: second.key, members };
  });

  test("主人的 Key 冷却期间借别人的，冷却结束后回到自己的 Key", async () => {
    const pool = await usePool("homing");
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
