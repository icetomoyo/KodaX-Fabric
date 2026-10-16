/**
 * 超管「调度画布」：只画 员工 → 虚拟 Key → 渠道 Key 三列，用来看渠道 Key 的真实调度情况。
 * 虚拟 Key 只画最近一段时间（默认 30 分钟）里真发过请求的；渠道 Key 全部画出来。
 *
 * 可能出错的方式（每条对应下面一个断言）：
 *  1. 画布还在画企业 / 部门 / 团队节点。
 *  2. 没有通信的虚拟 Key 也画出来了；员工名下多把 Key 只用了一把，另一把也被画上。
 *  3. 窗口外（3 小时前）的请求仍算作有通信；切到 24 小时后它又不出现。
 *  4. 连线按绑定关系画而不是按真实请求画：同一个人先后打到两把 Key 只画了现在绑定的那把，
 *     或者画了一条绑定了却从没请求过的线。
 *  5. 连线上的请求次数和库里 request_audits 对不上。
 *  6. 正在进行、还没落审计的请求（流式长请求）不在图上，直到请求结束才出现。
 *  7. 没有流量的渠道 Key 被藏掉（应当全部画出，标「空闲」）。
 *  8. 已绑定但正在冷却的渠道 Key 从图上消失，连同指向它的连线（旧版画布的 bug）。
 *  9. 持有人用自己持有的 Key 和借用别人的 Key 没有区分。
 * 10. 按产品线筛选后，别的产品线的渠道 Key 或连线还在。
 * 11. 搜索员工名后，没匹配的虚拟 Key 还在；或者匹配员工用到的渠道 Key 被一起藏掉。
 * 12. 渠道 Key 详情里「窗口内谁用过」和连线对不上；释放后绑定没删、页面没刷新。
 * 13. 详情里显示的是绑定范围（企业 / 部门），而不是这把 Key 上现在挂着的成员和人数（n/3）。
 * 14. 渠道 Key 列表（/api/admin/credentials）的「已连接」里混进企业名，或者没有列出现在挂着的成员。
 * （非超管调不到这些接口，由 auth-guard.spec.ts 覆盖。）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";
import { E2E } from "./env.ts";
import { isolateChannelPool } from "./pool-isolation.ts";
import {
  SCHED_ENTERPRISE,
  SCHED_MODEL,
  SCHED_PEOPLE,
  SCHED_POOLS,
  schedApiKey,
  schedLineCode,
  schedSecret,
  type SchedPersonKey,
} from "./scheduling-fixture.ts";

const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");
const POOL = "canvas" as const;
const HOUR_MS = 3_600_000;

type Hop = {
  virtualKeyId: number;
  credentialId: number;
  requests: number;
  failures: number;
  lastAt: string | null;
  holder: boolean;
};

type Graph = {
  windowMinutes: number;
  productLines: Array<{ id: number; name: string }>;
  employees: Array<{ id: number; name: string }>;
  virtualKeys: Array<{ id: number; employeeId: number; productLineId: number }>;
  credentials: Array<{
    id: number;
    label: string;
    productLineId: number;
    status: string;
    coolingKind: string | null;
    bound: boolean;
    members: Array<{ employeeId: number; name: string }>;
    memberLimit: number;
  }>;
  hops: Hop[];
};

let api: APIRequestContext;
let sql: postgres.Sql;
let token = "";
let lineId = 0;
let markerSeq = 0;
const employeeIds = new Map<SchedPersonKey, number>();
const personByEmployeeId = new Map<number, SchedPersonKey>();
const credentialIds = new Map<string, number>();
const labelByCredentialId = new Map<number, string>();
const report: Record<string, unknown> = {};

async function mockControl(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${E2E.mockUpstreamBaseUrl}/__control/${path}`, {
    method: body === undefined && path === "state" ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

async function call(person: SchedPersonKey): Promise<{ status: number; key: string | null; marker: string }> {
  markerSeq += 1;
  const marker = `${POOL}:${person}:${markerSeq}`;
  const res = await api.post("/v1/chat/completions", {
    headers: { Authorization: `Bearer ${schedApiKey(POOL, person)}` },
    data: { model: SCHED_MODEL, messages: [{ role: "user", content: marker }], stream: false },
    timeout: 90_000,
  });
  const body = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content ?? "";
  return { status: res.status(), key: /\[key=sk-sched-[A-Za-z0-9]+-([^\]]+)\]/.exec(content)?.[1] ?? null, marker };
}

async function hitsFor(marker: string): Promise<string[]> {
  const prefix = schedSecret(POOL, "");
  const state = (await mockControl("state")) as { hits: Array<{ secret: string; marker: string | null }> };
  return state.hits.filter((hit) => hit.marker === marker).map((hit) => hit.secret.slice(prefix.length));
}

async function waitFor<T>(description: string, probe: () => Promise<T | null | undefined | false>): Promise<T> {
  const deadline = Date.now() + 20_000;
  let last: unknown;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    last = value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`等待超时：${description}（最后一次结果 ${JSON.stringify(last)}）`);
}

async function graph(params: { windowMinutes?: number; productLineId?: number } = {}): Promise<Graph> {
  const res = await api.get("/api/admin/key-bindings", {
    headers: { Authorization: `Bearer ${token}` },
    params: params as Record<string, number>,
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { data: Graph }).data;
}

/** 连线换成「人 → Key 标签」便于读断言。 */
function readableHops(source: Graph) {
  const ownerOfKey = new Map(source.virtualKeys.map((row) => [row.id, row.employeeId]));
  return source.hops
    .map((hop) => ({
      person: personByEmployeeId.get(ownerOfKey.get(hop.virtualKeyId) ?? -1) ?? `key:${hop.virtualKeyId}`,
      key: labelByCredentialId.get(hop.credentialId) ?? `credential:${hop.credentialId}`,
      requests: hop.requests,
      holder: hop.holder,
      inFlightOnly: hop.lastAt == null,
    }))
    .sort((a, b) => `${a.person}/${a.key}`.localeCompare(`${b.person}/${b.key}`));
}

function fiveHourCapBody(resetAt: Date) {
  const wall = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(resetAt);
  return {
    error: {
      code: "1308",
      message: `已达到 5 小时使用上限，${wall} 后可继续使用。如需超限额按量付费使用，可联系管理员开启超额按量付费。`,
    },
  };
}

test.describe.serial("调度画布", () => {
  test.setTimeout(150_000);
  let restorePool: (() => Promise<void>) | null = null;

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: E2E.apiBaseUrl });
    sql = postgres(E2E.databaseUrl, { max: 2 });
    const login = await api.post("/api/auth/login", {
      data: { phone: E2E.admin.phone, password: E2E.admin.password },
    });
    token = ((await login.json()) as { data?: { token?: string } }).data?.token ?? "";
    expect(token, "管理员登录").toBeTruthy();

    const [line] = await sql<Array<{ id: string }>>`
      select id from product_lines where code = ${schedLineCode(POOL)}
    `;
    expect(line, "seed-scheduling 应写入画布用的套餐").toBeTruthy();
    lineId = Number(line.id);
    const people = await sql<Array<{ id: string; phone: string }>>`
      select id, phone from employees where phone like '1390000%'
    `;
    for (const key of SCHED_POOLS[POOL].users) {
      const row = people.find((item) => item.phone === SCHED_PEOPLE[key].phone)!;
      employeeIds.set(key, Number(row.id));
      personByEmployeeId.set(Number(row.id), key);
    }
    const keys = await sql<Array<{ id: string; label: string }>>`
      select id, label from upstream_credentials where product_line_id = ${lineId}
    `;
    for (const row of keys) {
      const label = row.label.replace(/^调度-/, "");
      credentialIds.set(label, Number(row.id));
      labelByCredentialId.set(Number(row.id), label);
    }
    restorePool = await isolateChannelPool(sql, "glm", [lineId]);
    await mockControl("reset", {});
  });

  test.afterAll(async () => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(resolve(ARTIFACT_DIR, "key-bindings-canvas.json"), `${JSON.stringify(report, null, 2)}\n`);
    await mockControl("release", {});
    await mockControl("reset", {});
    // 画布套餐只给这个用例用，跑完把 Key 状态和流量还原，免得影响后面统计全部夹具的用例。
    const ids = [...credentialIds.values()];
    if (ids.length) {
      await sql`
        update upstream_credentials
        set status = 'active', cool_until = null, last_failure_kind = null, last_vendor_code = null,
            five_hour_window_anchor = null, five_hour_window_base_credits = 0, weekly_window_reset_at = null
        where id in ${sql(ids)}
      `;
      await sql`delete from credential_usage_hourly where credential_id in ${sql(ids)}`;
      await sql`
        delete from request_error_logs where request_id in (
          select request_id from request_audits where product_line_id = ${lineId} or credential_id in ${sql(ids)}
        )
      `;
      await sql`delete from request_audits where product_line_id = ${lineId} or credential_id in ${sql(ids)}`;
    }
    await restorePool?.();
    await api?.dispose();
    await sql?.end({ timeout: 5 });
  });

  test("连线按窗口内的真实请求画，冷却中的 Key 不消失", async () => {
    // 三把 Key：cvso（容量持有人）、cvsf、cvsx。借用者摊到人少的 Key 上。
    expect((await call("ownerCap")).key, "持有人用自己的 Key").toBe("cvso");
    for (let i = 0; i < 2; i += 1) {
      expect((await call("guest1")).key, "cvso 已有人，借用甲去没人的 cvsf").toBe("cvsf");
    }
    expect((await call("guest2")).key, "借用乙去还没人的 cvsx").toBe("cvsx");
    expect((await call("guest3")).key, "三把都是 1 人，取 ID 小的 cvso").toBe("cvso");

    // 上游说 cvso 5 小时额度用尽：持有人这次请求换到人最少的 cvsf，借用丙还挂在 cvso 上。
    await mockControl("behavior", {
      secret: schedSecret(POOL, "cvso"),
      behavior: { type: "status", status: 429, body: fiveHourCapBody(new Date(Date.now() + 2 * HOUR_MS)) },
    });
    const moved = await call("ownerCap");
    expect(moved.key, "撞限额后换到另一把 Key").toBe("cvsf");
    expect(await hitsFor(moved.marker)).toEqual(["cvso", "cvsf"]);

    // 3 小时前同组同事打过 cvso：30 分钟窗口里不算有通信，24 小时窗口里要算。
    const [oldKey] = await sql<Array<{ id: string }>>`
      select id from employee_api_keys where employee_id = ${employeeIds.get("leafMate")!} and product_line_id = ${lineId}
    `;
    await sql`
      insert into request_audits
        (request_id, employee_id, employee_api_key_id, client_model, provider_code, product_line_id,
         credential_id, status, created_at)
      values
        (${`canvas-old-${Date.now()}`}, ${employeeIds.get("leafMate")!}, ${oldKey.id}, ${SCHED_MODEL}, 'glm',
         ${lineId}, ${credentialIds.get("cvso")!}, 'success', ${new Date(Date.now() - 3 * HOUR_MS)})
    `;

    const recent = await graph({ productLineId: lineId });
    const recentHops = readableHops(recent);
    expect(recentHops, "连线 = 窗口内真实请求，持有人自用 / 借用分开（2、4、9）").toEqual([
      { person: "guest1", key: "cvsf", requests: 2, holder: false, inFlightOnly: false },
      { person: "guest2", key: "cvsx", requests: 1, holder: false, inFlightOnly: false },
      { person: "guest3", key: "cvso", requests: 1, holder: false, inFlightOnly: false },
      { person: "ownerCap", key: "cvsf", requests: 1, holder: false, inFlightOnly: false },
      { person: "ownerCap", key: "cvso", requests: 1, holder: true, inFlightOnly: false },
    ].sort((a, b) => `${a.person}/${a.key}`.localeCompare(`${b.person}/${b.key}`)));
    expect(
      new Set(recent.virtualKeys.map((row) => personByEmployeeId.get(row.employeeId))),
      "只画有通信的虚拟 Key：同组同事在窗口外、借用丁没调用过（2、3）",
    ).toEqual(new Set(["guest1", "guest2", "guest3", "ownerCap"]));

    const audited = await sql<Array<{ employee_api_key_id: string; credential_id: string; n: number }>>`
      select employee_api_key_id, credential_id, count(*)::int as n from request_audits
      where product_line_id = ${lineId} and created_at >= ${new Date(Date.now() - 30 * 60_000)}
        and employee_api_key_id is not null and credential_id is not null
      group by 1, 2
    `;
    expect(
      recent.hops.map((hop) => `${hop.virtualKeyId}:${hop.credentialId}:${hop.requests}`).sort(),
      "连线次数与 request_audits 一致（5）",
    ).toEqual(audited.map((row) => `${row.employee_api_key_id}:${row.credential_id}:${row.n}`).sort());

    const memberNames = (label: string) =>
      (recent.credentials.find((row) => row.id === credentialIds.get(label))?.members ?? [])
        .map((member) => personByEmployeeId.get(member.employeeId))
        .sort();
    const cooled = recent.credentials.find((row) => row.id === credentialIds.get("cvso"));
    expect(cooled?.status, "冷却中的已绑定 Key 仍在图上（8）").toBe("cooling");
    expect(
      recent.credentials.every((row) => row.memberLimit === 3),
      "每把 Key 最多 3 人",
    ).toBe(true);
    expect(
      { cvso: memberNames("cvso"), cvsf: memberNames("cvsf"), cvsx: memberNames("cvsx") },
      "每把 Key 返回的是现在挂着的成员，不是绑定范围（13）",
    ).toEqual({ cvso: ["guest3"], cvsf: ["guest1", "ownerCap"], cvsx: ["guest2"] });
    expect(
      recent.credentials.every((row) => row.productLineId === lineId),
      "按产品线筛选后只剩这条产品线的 Key（10）",
    ).toBe(true);

    const day = await graph({ productLineId: lineId, windowMinutes: 1440 });
    expect(
      readableHops(day).find((hop) => hop.person === "leafMate"),
      "24 小时窗口里出现 3 小时前的请求（3）",
    ).toEqual({ person: "leafMate", key: "cvso", requests: 1, holder: false, inFlightOnly: false });

    const everything = await graph();
    const [{ n: credentialTotal }] = await sql<Array<{ n: number }>>`select count(*)::int as n from upstream_credentials`;
    expect(everything.credentials.length, "渠道 Key 全部返回，没流量的也在（7）").toBe(credentialTotal);
    const keysWithHop = new Set(everything.hops.map((hop) => hop.virtualKeyId));
    expect(
      everything.virtualKeys.every((row) => keysWithHop.has(row.id)),
      "不带筛选时也只有有通信的虚拟 Key（2）",
    ).toBe(true);

    // 渠道 Key 列表：「已连接」里不再混进企业名，成员单独列出（14）。
    const listRes = await api.get(`/api/admin/credentials?productLineId=${lineId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listed = ((await listRes.json()) as {
      data: Array<{ id: number; members: Array<{ name: string }>; memberLimit: number; connectedNames: string[]; binding?: unknown }>;
    }).data.find((row) => row.id === credentialIds.get("cvsf"))!;
    expect(listed.members.map((member) => member.name).sort(), "列表里列出 cvsf 现在的成员").toEqual(
      [SCHED_PEOPLE.guest1.name, SCHED_PEOPLE.ownerCap.name].sort(),
    );
    expect(listed.memberLimit).toBe(3);
    expect(listed.connectedNames, "「已连接」里不能有企业名").not.toContain(SCHED_ENTERPRISE.name);
    expect(listed.binding, "不再返回绑定范围").toBeUndefined();

    report.api = {
      recent: recentHops,
      members: { cvso: memberNames("cvso"), cvsf: memberNames("cvsf"), cvsx: memberNames("cvsx") },
      day: readableHops(day),
      unfilteredCredentials: everything.credentials.length,
      unfilteredVirtualKeys: everything.virtualKeys.length,
      credentialList: { members: listed.members, connectedNames: listed.connectedNames },
    };
  });

  test("画布只有员工 / 虚拟 Key / 渠道 Key 三列，在途请求不刷新也能出现", async ({ page }) => {
    await page.goto("/");
    await page.getByText("账户登录", { exact: true }).click();
    await page.getByPlaceholder("11 位手机号").fill(E2E.admin.phone);
    await page.getByPlaceholder("请输入密码").fill(E2E.admin.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
    await page.goto("/admin/key-bindings");

    const [{ n: credentialTotal }] = await sql<Array<{ n: number }>>`select count(*)::int as n from upstream_credentials`;
    await expect(page.getByTestId("canvas-stats"), "统计里是全部渠道 Key（7）").toContainText(
      new RegExp(`有流量渠道 Key \\d+/${credentialTotal}`),
      { timeout: 15_000 },
    );
    // 默认视口框住有流量的部分；点「适配视图」看全图，没流量的 Key 在右侧网格里。
    await page.locator(".vue-flow__controls-fitview").click();
    await expect(page.locator(".lane-header", { hasText: "没有流量" }), "没流量的渠道 Key 也画出来（7）").toBeVisible();
    await page.locator(".toolbar-select").click();
    await page.getByRole("option", { name: new RegExp(SCHED_POOLS[POOL].name) }).click();

    const nodes = (type: string) => page.locator(`.vue-flow__node-${type}`);
    await expect(nodes("credential"), "只剩画布套餐的三把 Key（10）").toHaveCount(3);
    await expect(nodes("employee")).toHaveCount(4);
    await expect(nodes("virtual_key")).toHaveCount(4);
    await expect(page.locator(".vue-flow__edge-traffic"), "五条真实请求连线").toHaveCount(5);
    for (const type of ["enterprise", "department", "team"]) {
      await expect(nodes(type), `不再画${type}节点（1）`).toHaveCount(0);
    }
    await expect(
      nodes("credential").filter({ hasText: "调度-cvso" }).locator(".graph-node.cooling_5h"),
      "冷却中的已绑定 Key 照样画出来并标冷却（8）",
    ).toBeVisible();
    await expect(
      nodes("credential").filter({ hasText: "调度-cvsf" }),
      "节点上显示现在挂着几个人（13）",
    ).toContainText("2/3 人");

    // 在途、还没落审计的请求：页面不点刷新也要冒出来（6）。借用丁去人最少的 cvsx。
    await mockControl("behavior", { secret: schedSecret(POOL, "cvsx"), behavior: { type: "hold" } });
    const held = call("guest4");
    await waitFor("cvsx 上有一路在途", async () => {
      const state = (await mockControl("state")) as { inFlight: Record<string, number> };
      return (state.inFlight[schedSecret(POOL, "cvsx")] ?? 0) === 1;
    });
    const live = await graph({ productLineId: lineId });
    expect(
      readableHops(live).find((hop) => hop.person === "guest4"),
      "接口把在途请求并进连线（6）",
    ).toEqual({ person: "guest4", key: "cvsx", requests: 0, holder: false, inFlightOnly: true });
    await expect(
      nodes("employee").filter({ hasText: SCHED_PEOPLE.guest4.name }),
      "在途请求的员工自动出现在画布上（6）",
    ).toBeVisible({ timeout: 15_000 });
    await mockControl("release", {});
    expect((await held).key).toBe("cvsx");

    // 搜索：只留借用甲的虚拟 Key 和他用到的 cvsf（11）。
    await page.getByPlaceholder("搜索员工 / Key").fill(SCHED_PEOPLE.guest1.name);
    await expect(nodes("virtual_key")).toHaveCount(1);
    await expect(nodes("credential")).toHaveCount(1);
    await expect(nodes("credential")).toContainText("调度-cvsf");
    await page.getByPlaceholder("搜索员工 / Key").fill("");

    // 24 小时窗口：3 小时前的同组同事出现（3）。
    await page.getByText("24 小时", { exact: true }).click();
    await expect(nodes("employee").filter({ hasText: SCHED_PEOPLE.leafMate.name })).toBeVisible();
    await page.getByText("30 分钟", { exact: true }).click();
    await expect(nodes("employee").filter({ hasText: SCHED_PEOPLE.leafMate.name })).toHaveCount(0);

    // 详情：窗口内谁用过和连线一致；成员显示人和人数，不显示绑定范围（9、12、13）。
    await nodes("credential").filter({ hasText: "调度-cvso" }).click();
    const drawer = page.locator(".el-drawer").filter({ hasText: "调度-cvso" });
    const users = page.getByTestId("credential-users").locator("li");
    await expect(users).toHaveCount(2);
    await expect(users.filter({ hasText: SCHED_PEOPLE.guest3.name })).toContainText("借用");
    await expect(users.filter({ hasText: SCHED_PEOPLE.ownerCap.name })).toContainText("持有人自用");
    await expect(users.filter({ hasText: SCHED_PEOPLE.ownerCap.name })).toContainText("1 次");
    await expect(drawer.getByRole("heading", { name: "成员 1/3" })).toBeVisible();
    await expect(page.getByTestId("credential-members")).toHaveText(`${SCHED_PEOPLE.guest3.name}（借用）`);
    await expect(drawer, "不再显示「当前挂在 企业」").not.toContainText("当前挂在");
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, "key-bindings-canvas.png") });

    // 释放：库里的绑定删掉，抽屉刷新成「当前没有成员」（12）。
    await page.getByRole("button", { name: "释放绑定" }).click();
    await page.getByRole("button", { name: "释放", exact: true }).click();
    await expect(drawer.getByText("当前没有成员")).toBeVisible();
    const left = await sql`select 1 from credential_bindings where credential_id = ${credentialIds.get("cvso")!}`;
    expect(left.length, "释放后库里没有 cvso 的绑定").toBe(0);

    report.ui = {
      stats: (await page.getByTestId("canvas-stats").innerText()).trim(),
      liveHop: readableHops(live).find((hop) => hop.person === "guest4"),
      screenshot: "e2e/artifacts/key-bindings-canvas.png",
    };
  });
});
