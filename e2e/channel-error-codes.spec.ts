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
import { E2E_ORG } from "./org-fixture.ts";
import { isolateChannelPool } from "./pool-isolation.ts";

/**
 * 每个渠道只认自己的错误码。智谱的业务码由调度用例（key-scheduling.spec.ts）覆盖，
 * 这里覆盖 DeepSeek 和火山方舟：管理员按正常流程建套餐、直接加两把 Key，员工建 API Key 调用，
 * 上游是本机 mock（官方地址由 rewrite-upstream-fetch 改写过去），按 Key 编排错误报文。
 *
 * 可能出错的方式（每条对应下面一个断言）：
 *  1. 火山方舟 5 小时额度用尽（429 AccountQuotaExceeded）只按普通限流短冷却，
 *     没有冷却到报文给的重置时刻；或者这次请求没有换 Key 完成。
 *  2. 火山方舟服务端过载（429 ServerOverloaded）冷却了健康的 Key，或者换 Key 连扫。
 *  3. 火山方舟的 Key 回了智谱的业务码（1313 公平使用）时按智谱规则停用了 Key：
 *     渠道之间的错误码串用了。
 *  4. DeepSeek 余额不足（402）被当成调用方的请求错误直接失败，没有换 Key；
 *     或者 Key 没有长冷却，下一个请求又打到这把没钱的 Key 上。
 *  5. DeepSeek 服务器繁忙（503）被当成这把 Key 的故障，换 Key 连扫。
 */
const ARTIFACT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "artifacts/channel-error-codes.json",
);
const PASSWORD = "E2eErr@2026";
const CALLER_PHONE = "13700003000";
/** server/src/config.ts 的默认值：普通限流冷却 / 额度用尽冷却。 */
const COOLDOWN_SECONDS = 300;
const QUOTA_COOLDOWN_SECONDS = 1_800;

const CHANNELS = ["deepseek", "huoshan"] as const;
type ChannelCode = (typeof CHANNELS)[number];
type Slot = "k1" | "k2";

const CHANNEL_MODEL: Record<ChannelCode, string> = {
  deepseek: "deepseek/deepseek-flash",
  huoshan: "huoshan/doubao-seed-2.0-mini",
};

type Behavior =
  | { type: "ok" }
  | { type: "status"; status: number; body: unknown };

type CallResult = {
  marker: string;
  status: number;
  slot: Slot | null;
  code: string | null;
  retryAfter: string | null;
};

type CredentialRow = {
  status: string;
  cool_until: Date | null;
  last_failure_kind: string | null;
  last_vendor_code: string | null;
};

let api: APIRequestContext;
let sql: postgres.Sql;
let markerSeq = 0;
const lineIds = {} as Record<ChannelCode, number>;
const virtualKeys = {} as Record<ChannelCode, string>;
const restorePools: Array<() => Promise<void>> = [];
const report: Record<string, unknown> = {};

function secretFor(channel: ChannelCode, slot: Slot): string {
  return `sk-err-${channel}-${slot}`;
}

function otherSlot(slot: Slot): Slot {
  return slot === "k1" ? "k2" : "k1";
}

async function loginToken(phone: string, password: string): Promise<string> {
  const res = await api.post("/api/auth/login", { data: { phone, password } });
  const token = ((await res.json()) as { data?: { token?: string } }).data?.token;
  if (!token) throw new Error(`登录失败 ${phone}`);
  return token;
}

async function postJson(url: string, token: string, data: unknown): Promise<Record<string, unknown>> {
  const res = await api.post(url, { data, headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { success?: boolean; data?: unknown };
  expect(body.success, `POST ${url}: ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  return body.data as Record<string, unknown>;
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await api.get(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { success?: boolean; data?: unknown };
  expect(body.success, `GET ${url}: ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  return body.data as T;
}

async function mockControl(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${E2E.mockUpstreamBaseUrl}/__control/${path}`, {
    method: path === "state" && body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

async function setBehavior(channel: ChannelCode, slot: Slot, behavior: Behavior): Promise<void> {
  await mockControl("behavior", { secret: secretFor(channel, slot), behavior });
}

async function toResult(res: APIResponse, marker: string): Promise<CallResult> {
  let body: { choices?: Array<{ message?: { content?: string } }>; error?: { code?: string } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // 非 JSON 应答按失败处理。
  }
  const content = body.choices?.[0]?.message?.content ?? "";
  const matched = /\[key=sk-err-[a-z]+-(k[12])\]/.exec(content);
  return {
    marker,
    status: res.status(),
    slot: (matched?.[1] as Slot | undefined) ?? null,
    code: body.error?.code ?? null,
    retryAfter: res.headers()["retry-after"] ?? null,
  };
}

async function call(channel: ChannelCode): Promise<CallResult> {
  markerSeq += 1;
  const marker = `err:${channel}:${markerSeq}`;
  const res = await api.post("/v1/chat/completions", {
    headers: { Authorization: `Bearer ${virtualKeys[channel]}` },
    data: { model: CHANNEL_MODEL[channel], messages: [{ role: "user", content: marker }], stream: false },
    timeout: 60_000,
  });
  return toResult(res, marker);
}

async function hitsFor(channel: ChannelCode, marker: string): Promise<string[]> {
  const prefix = secretFor(channel, "k1").slice(0, -2);
  const state = (await mockControl("state")) as {
    hits: Array<{ secret: string; marker: string | null }>;
  };
  return state.hits
    .filter((hit) => hit.marker === marker)
    .map((hit) => hit.secret.slice(prefix.length));
}

async function credentialRow(channel: ChannelCode, slot: Slot): Promise<CredentialRow> {
  const [row] = await sql<CredentialRow[]>`
    select status, cool_until, last_failure_kind, last_vendor_code
    from upstream_credentials
    where product_line_id = ${lineIds[channel]} and label = ${`err-${slot}`}
  `;
  if (!row) throw new Error(`缺少渠道 Key ${channel}/${slot}`);
  return row;
}

/** 两把 Key 放回健康状态，再发一次成功的请求，看员工当前绑在哪把 Key 上。 */
async function healthyBoundSlot(channel: ChannelCode): Promise<Slot> {
  await sql`
    update upstream_credentials
    set status = 'active', cool_until = null, last_failure_kind = null, last_vendor_code = null
    where product_line_id = ${lineIds[channel]}
  `;
  const warm = await call(channel);
  expect(warm.status, `${channel} 两把 Key 都健康时应成功`).toBe(200);
  expect(warm.slot).not.toBeNull();
  return warm.slot!;
}

function secondsUntil(date: Date | null): number {
  return date ? (date.getTime() - Date.now()) / 1_000 : 0;
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

test.describe.serial("渠道错误码：每个渠道只认自己的", () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: E2E.apiBaseUrl });
    sql = postgres(E2E.databaseUrl, { max: 2 });
    await mockControl("reset", {});

    const admin = await loginToken(E2E.admin.phone, E2E.admin.password);
    const enterprises = await getJson<Array<{ id: number; name: string }>>("/api/admin/enterprises", admin);
    const enterprise = enterprises.find((row) => row.name === E2E_ORG.childA.name);
    expect(enterprise, `缺少夹具企业 ${E2E_ORG.childA.name}`).toBeTruthy();
    const departments = await getJson<Array<{ id: number; name: string }>>(
      `/api/admin/departments?enterpriseId=${enterprise!.id}`,
      admin,
    );
    const department = departments.find((row) => row.name === E2E_ORG.department.name);
    expect(department, `缺少夹具部门 ${E2E_ORG.department.name}`).toBeTruthy();
    const teams = await getJson<Array<{ id: number; isDefault: boolean }>>(
      `/api/admin/teams?departmentId=${department!.id}`,
      admin,
    );
    const team = teams.find((row) => row.isDefault);
    expect(team, "部门应有默认团队").toBeTruthy();

    const registered = await api.post("/api/auth/register", {
      data: { name: "Err-Caller", phone: CALLER_PHONE, password: PASSWORD },
    });
    const callerId = ((await registered.json()) as { data?: { id?: number } }).data?.id;
    expect(callerId, "注册调用方").toBeTruthy();
    await postJson(`/api/admin/teams/${team!.id}/members`, admin, { employeeId: callerId });
    const caller = await loginToken(CALLER_PHONE, PASSWORD);

    for (const channel of CHANNELS) {
      const line = await postJson("/api/admin/product-lines", admin, {
        provider: channel,
        ...(channel === "huoshan" ? { productType: "coding_plan" } : {}),
        name: `Err ${channel}`,
        tag: "err",
        seatCount: 2,
        status: "active",
        supportedProtocols: ["openai_chat"],
      });
      lineIds[channel] = line.id as number;
      for (const slot of ["k1", "k2"] as const) {
        await postJson("/api/admin/credentials", admin, {
          productLineId: lineIds[channel],
          label: `err-${slot}`,
          secret: secretFor(channel, slot),
        });
      }
      const created = await postJson("/api/me/api-keys", caller, {
        name: `err-vk-${channel}`,
        departmentId: department!.id,
        productLineId: lineIds[channel],
        protocol: "openai_chat",
      });
      virtualKeys[channel] = created.key as string;
      // 渠道池里还有别的用例建的套餐：只启用这一条，请求只会落在这两把 Key 上。
      restorePools.push(await isolateChannelPool(sql, channel, [lineIds[channel]]));
    }
  });

  test.beforeEach(async () => {
    await mockControl("reset", {});
  });

  test.afterAll(async () => {
    mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
    writeFileSync(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    for (const restore of restorePools) await restore();
    await mockControl("reset", {}).catch(() => {});
    await api?.dispose();
    await sql?.end({ timeout: 5 });
  });

  test("火山方舟 5 小时额度用尽（AccountQuotaExceeded）：冷却到上游给的重置时刻，换 Key 完成请求", async () => {
    const bound = await healthyBoundSlot("huoshan");
    const resetAt = new Date(Math.floor((Date.now() + 2 * 3_600_000) / 1_000) * 1_000);
    await setBehavior("huoshan", bound, {
      type: "status",
      status: 429,
      body: {
        error: {
          code: "AccountQuotaExceeded",
          message: `You have exceeded the 5-hour usage quota. It will reset at ${shanghaiWallTime(resetAt)} +0800 CST.`,
          param: "",
          type: "TooManyRequests",
        },
      },
    });
    const result = await call("huoshan");
    expect(result.status, "额度用尽的 Key 换掉，这次请求照常完成").toBe(200);
    expect(await hitsFor("huoshan", result.marker)).toEqual([bound, otherSlot(bound)]);
    const row = await credentialRow("huoshan", bound);
    expect(row.status).toBe("cooling");
    expect(row.last_vendor_code).toBe("AccountQuotaExceeded");
    expect(row.last_failure_kind).toBe("five_hour_cap");
    const driftMs = Math.abs((row.cool_until?.getTime() ?? 0) - resetAt.getTime());
    expect(driftMs, "冷却截止时间应等于报文里的重置时刻").toBeLessThan(2_000);
    report.huoshanQuota = {
      hits: [bound, otherSlot(bound)],
      keyStatus: row.status,
      failureKind: row.last_failure_kind,
      coolUntilDriftMs: driftMs,
    };
  });

  test("火山方舟服务端过载（ServerOverloaded）：不冷却、不换 Key", async () => {
    const bound = await healthyBoundSlot("huoshan");
    await setBehavior("huoshan", bound, {
      type: "status",
      status: 429,
      body: {
        error: {
          code: "ServerOverloaded",
          message: "The service is currently unable to handle additional requests due to server overload. Please retry later.",
          param: "",
          type: "TooManyRequests",
        },
      },
    });
    const result = await call("huoshan");
    expect(result.status).toBe(429);
    expect(await hitsFor("huoshan", result.marker), "过载与哪把 Key 无关，不换").toEqual([bound]);
    expect(Number(result.retryAfter)).toBeGreaterThan(0);
    expect(Number(result.retryAfter)).toBeLessThanOrEqual(30);
    const row = await credentialRow("huoshan", bound);
    expect(row.status, "过载不能冷却健康的 Key").toBe("active");
    expect(row.cool_until).toBeNull();
    report.huoshanOverloaded = { hits: [bound], status: result.status, retryAfter: result.retryAfter };
  });

  test("火山方舟的 Key 回了智谱业务码（1313）：不按智谱规则停用，只当普通限流", async () => {
    const bound = await healthyBoundSlot("huoshan");
    await setBehavior("huoshan", bound, {
      type: "status",
      status: 429,
      body: {
        error: {
          code: "1313",
          message: "您的账户当前使用模式不符合公平使用策略，请求频率已受到限制。",
        },
      },
    });
    const result = await call("huoshan");
    expect(result.status).toBe(200);
    expect(await hitsFor("huoshan", result.marker)).toEqual([bound, otherSlot(bound)]);
    const row = await credentialRow("huoshan", bound);
    expect(row.status, "火山方舟没有 1313，这把 Key 不该被停用").toBe("cooling");
    expect(row.last_failure_kind).toBe("rate_limit");
    const coolSeconds = secondsUntil(row.cool_until);
    expect(coolSeconds, "按普通限流短冷却").toBeLessThanOrEqual(COOLDOWN_SECONDS + 10);
    expect(coolSeconds).toBeGreaterThan(COOLDOWN_SECONDS - 60);
    report.huoshanForeignCode = {
      hits: [bound, otherSlot(bound)],
      keyStatus: row.status,
      failureKind: row.last_failure_kind,
      coolSeconds: Math.round(coolSeconds),
    };
  });

  test("DeepSeek 余额不足（402）：长冷却，换 Key 完成请求", async () => {
    const bound = await healthyBoundSlot("deepseek");
    await setBehavior("deepseek", bound, {
      type: "status",
      status: 402,
      body: {
        error: {
          message: "Insufficient Balance",
          type: "unknown_error",
          param: null,
          code: "invalid_request_error",
        },
      },
    });
    const result = await call("deepseek");
    expect(result.status, "没钱的 Key 换掉，这次请求照常完成").toBe(200);
    expect(await hitsFor("deepseek", result.marker)).toEqual([bound, otherSlot(bound)]);
    const row = await credentialRow("deepseek", bound);
    expect(row.status).toBe("cooling");
    const coolSeconds = secondsUntil(row.cool_until);
    expect(coolSeconds, "余额不足按额度用尽长冷却").toBeGreaterThan(QUOTA_COOLDOWN_SECONDS - 60);
    expect(coolSeconds).toBeLessThanOrEqual(QUOTA_COOLDOWN_SECONDS + 10);

    const next = await call("deepseek");
    expect(next.status).toBe(200);
    expect(await hitsFor("deepseek", next.marker), "冷却中不再打这把 Key").toEqual([otherSlot(bound)]);
    report.deepseekBalance = {
      hits: [bound, otherSlot(bound)],
      keyStatus: row.status,
      coolSeconds: Math.round(coolSeconds),
      nextHits: [otherSlot(bound)],
    };
  });

  test("DeepSeek 服务器繁忙（503）：不换 Key、不动 Key 状态", async () => {
    const bound = await healthyBoundSlot("deepseek");
    await setBehavior("deepseek", bound, {
      type: "status",
      status: 503,
      body: { error: { message: "Server overloaded", type: "server_error", param: null, code: null } },
    });
    const result = await call("deepseek");
    expect(result.status, "上游繁忙统一按 429 还给调用方").toBe(429);
    expect(await hitsFor("deepseek", result.marker), "不能把繁忙的请求扫到别的 Key 上").toEqual([bound]);
    expect(Number(result.retryAfter)).toBeGreaterThan(0);
    const row = await credentialRow("deepseek", bound);
    expect(row.status).toBe("active");
    expect(row.last_failure_kind, "繁忙不算这把 Key 的故障").toBeNull();
    report.deepseekBusy = { hits: [bound], status: result.status, retryAfter: result.retryAfter };
  });
});
