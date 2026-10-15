import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import postgres from "postgres";
import { E2E } from "./env.ts";
import { E2E_ORG } from "./org-fixture.ts";

/**
 * One channel = one KEY pool.
 * A request with prefix `xx/` may be served by ANY active KEY of ANY product
 * of channel `xx`, never by a KEY of another channel.
 *
 * Official template URLs have no env override. GLM coding_plan relay always
 * uses the domestic gateway. The server process loads
 * e2e/rewrite-upstream-fetch.mjs so those hosts hit the local mock, while
 * routing / binding / Authorization headers still run. deepseek / huoshan
 * protocolConfigs are also pointed at the mock in the test DB after create.
 */
const ARTIFACT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "artifacts/channel-pool-report.json",
);
const REQUESTS_PER_CHANNEL = 12;
const PASSWORD = "E2ePool@2026";
const UNKNOWN_MODEL = "unknown/not-a-channel";

const CHANNELS = ["glm", "deepseek", "huoshan"] as const;
type ChannelCode = (typeof CHANNELS)[number];

const CHANNEL_MODEL: Record<ChannelCode, string> = {
  glm: "glm/glm-5.3",
  deepseek: "deepseek/deepseek-flash",
  huoshan: "huoshan/doubao-seed-2.0-mini",
};

type ProductSlot = "a" | "b";

type ProductRecord = {
  productLineId: number;
  credentialId: number;
  secret: string;
  secretLabel: string;
  virtualKey: string;
};

type RequestRecord = {
  channel: ChannelCode | "unknown";
  model: string;
  productLineId: number | null;
  credentialId: number | null;
  secretLabel: string | null;
  upstreamStatus: number | null;
  httpStatus: number;
  marker: string;
};

type JsonBody = { success?: boolean; data?: unknown; message?: string };

type MockState = {
  hits: Array<{ seq: number; secret: string; model: string; marker: string | null }>;
};

const products: Record<ChannelCode, Record<ProductSlot, ProductRecord>> = {
  glm: {} as Record<ProductSlot, ProductRecord>,
  deepseek: {} as Record<ProductSlot, ProductRecord>,
  huoshan: {} as Record<ProductSlot, ProductRecord>,
};
const secretIndex = new Map<string, { channel: ChannelCode; slot: ProductSlot }>();
const requests: RequestRecord[] = [];
let unknownResult: { httpStatus: number; code: string | null } | null = null;
let channelTypes: unknown = null;
let api: APIRequestContext;
let db: postgres.Sql;

function secretFor(channel: ChannelCode, slot: ProductSlot): string {
  return `sk-pool-${channel}-${slot}-secret`;
}

function secretLabel(channel: ChannelCode, slot: ProductSlot): string {
  return `${channel}-${slot}`;
}

async function loginToken(phone: string, password: string): Promise<string> {
  const res = await api.post("/api/auth/login", { data: { phone, password } });
  const body = (await res.json()) as { success?: boolean; data?: { token?: string } };
  expect(
    body.success === true && typeof body.data?.token === "string",
    `login failed ${phone}: ${JSON.stringify(body)}`,
  ).toBeTruthy();
  return body.data!.token as string;
}

async function postJson(
  url: string,
  token: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  const res = await api.post(url, { data, headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as JsonBody;
  expect(
    body.success === true,
    `POST ${url} failed: ${res.status()} ${JSON.stringify(body)}`,
  ).toBeTruthy();
  return body.data as Record<string, unknown>;
}

async function getJson(url: string, token: string): Promise<unknown> {
  const res = await api.get(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as JsonBody;
  expect(
    body.success === true,
    `GET ${url} failed: ${res.status()} ${JSON.stringify(body)}`,
  ).toBeTruthy();
  return body.data;
}

async function mockControl(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${E2E.mockUpstreamBaseUrl}/__control/${path}`, {
    method: path === "state" && body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

function createBody(channel: ChannelCode, name: string) {
  return {
    provider: channel,
    ...(channel === "glm" ? { variant: "domestic", productType: "coding_plan" } : {}),
    ...(channel === "huoshan" ? { productType: "coding_plan" } : {}),
    name,
    tag: "pool",
    seatCount: 1,
    status: "active",
    supportedProtocols: ["openai_chat"],
  };
}

async function pointLineAtMock(productLineId: number): Promise<void> {
  const [row] = await db<Array<{ protocol_configs: unknown }>>`
    select protocol_configs from product_lines where id = ${productLineId}
  `;
  const current =
    row?.protocol_configs && typeof row.protocol_configs === "object" && !Array.isArray(row.protocol_configs)
      ? { ...(row.protocol_configs as Record<string, unknown>) }
      : {};
  const openai =
    current.openai_chat && typeof current.openai_chat === "object" && !Array.isArray(current.openai_chat)
      ? { ...(current.openai_chat as Record<string, unknown>) }
      : { authStyle: "bearer" };
  current.openai_chat = { ...openai, baseUrl: `${E2E.mockUpstreamBaseUrl}/v1` };
  await db.unsafe(
    "update product_lines set protocol_configs = $1::jsonb where id = $2",
    [JSON.stringify(current), productLineId],
  );
}

async function registerEmployee(name: string, phone: string): Promise<number> {
  const res = await api.post("/api/auth/register", {
    data: { name, phone, password: PASSWORD },
  });
  const body = (await res.json()) as { success?: boolean; data?: { id: number } };
  expect(
    body.success === true && typeof body.data?.id === "number",
    `register failed ${phone}: ${JSON.stringify(body)}`,
  ).toBeTruthy();
  return body.data!.id;
}

async function createApiKey(
  phone: string,
  departmentId: number,
  productLineId: number,
  name: string,
): Promise<string> {
  const token = await loginToken(phone, PASSWORD);
  const created = await postJson("/api/me/api-keys", token, {
    name,
    departmentId,
    productLineId,
    protocol: "openai_chat",
  });
  expect(typeof created.key, `API key plaintext missing for ${phone}`).toBe("string");
  return created.key as string;
}

function lookupSecret(secret: string): { channel: ChannelCode; slot: ProductSlot } | null {
  return secretIndex.get(secret) ?? null;
}

function writeArtifact(): void {
  mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
  const byChannel = Object.fromEntries(
    CHANNELS.map((channel) => {
      const hits = requests.filter((row) => row.channel === channel);
      const labels = [...new Set(hits.map((row) => row.secretLabel).filter(Boolean))];
      return [
        channel,
        {
          model: CHANNEL_MODEL[channel],
          requestCount: hits.length,
          secretLabelsHit: labels,
          bothProductsHit: labels.includes(secretLabel(channel, "a"))
            && labels.includes(secretLabel(channel, "b")),
          foreignKeyHits: hits.filter(
            (row) => row.secretLabel != null && !row.secretLabel.startsWith(`${channel}-`),
          ).length,
        },
      ];
    }),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    channelTypes,
    limitation: {
      glm: "coding_plan relay ignores stored protocolConfigs and always calls https://open.bigmodel.cn; e2e/rewrite-upstream-fetch.mjs rewrites that host to the mock",
      deepseek: `protocolConfigs.openai_chat.baseUrl patched to ${E2E.mockUpstreamBaseUrl}/v1 after admin create`,
      huoshan: `protocolConfigs.openai_chat.baseUrl patched to ${E2E.mockUpstreamBaseUrl}/v1 after admin create`,
    },
    products: Object.fromEntries(
      CHANNELS.map((channel) => [
        channel,
        {
          a: products[channel].a
            ? {
                productLineId: products[channel].a.productLineId,
                credentialId: products[channel].a.credentialId,
                secretLabel: products[channel].a.secretLabel,
              }
            : null,
          b: products[channel].b
            ? {
                productLineId: products[channel].b.productLineId,
                credentialId: products[channel].b.credentialId,
                secretLabel: products[channel].b.secretLabel,
              }
            : null,
        },
      ]),
    ),
    unknownPrefix: unknownResult,
    summary: byChannel,
    requests,
  };
  writeFileSync(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

test.describe("channel pool: one channel = one KEY pool", () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: E2E.apiBaseUrl });
    db = postgres(E2E.databaseUrl, { max: 2 });
    await mockControl("reset", {});

    const admin = await loginToken(E2E.admin.phone, E2E.admin.password);
    channelTypes = await getJson("/api/admin/channel-types", admin);
    const enterprises = (await getJson("/api/admin/enterprises", admin)) as Array<{
      id: number;
      name: string;
    }>;
    const enterprise = enterprises.find((row) => row.name === E2E_ORG.childA.name);
    expect(enterprise, `missing fixture enterprise ${E2E_ORG.childA.name}`).toBeTruthy();
    const departments = (await getJson(
      `/api/admin/departments?enterpriseId=${enterprise!.id}`,
      admin,
    )) as Array<{ id: number; name: string }>;
    const department = departments.find((row) => row.name === E2E_ORG.department.name);
    expect(department, `missing fixture department ${E2E_ORG.department.name}`).toBeTruthy();
    const teamRows = (await getJson(
      `/api/admin/teams?departmentId=${department!.id}`,
      admin,
    )) as Array<{ id: number; isDefault: boolean }>;
    const defaultTeam = teamRows.find((row) => row.isDefault);
    expect(defaultTeam, "department should have a default team").toBeTruthy();

    const callerId = await registerEmployee("Pool-Caller", "13700002000");
    await postJson(`/api/admin/teams/${defaultTeam!.id}/members`, admin, {
      employeeId: callerId,
    });

    for (const channel of CHANNELS) {
      for (const slot of ["a", "b"] as const) {
        const phone = slot === "a"
          ? `1370000201${CHANNELS.indexOf(channel)}`
          : `1370000202${CHANNELS.indexOf(channel)}`;
        const employeeId = await registerEmployee(`Pool-${channel}-${slot}`, phone);
        await postJson(`/api/admin/teams/${defaultTeam!.id}/members`, admin, {
          employeeId,
        });

        const line = await postJson(
          "/api/admin/product-lines",
          admin,
          createBody(channel, `Pool ${channel} ${slot}`),
        );
        const productLineId = line.id as number;
        expect(typeof productLineId, `product line id missing for ${channel}/${slot}`).toBe(
          "number",
        );
        if (channel !== "glm") await pointLineAtMock(productLineId);

        const seat = await postJson("/api/admin/channel-seats", admin, {
          employeeId,
          productLineId,
        });
        const secret = secretFor(channel, slot);
        const credential = await postJson("/api/admin/credentials", admin, {
          productLineId,
          label: `pool-${secretLabel(channel, slot)}`,
          secret,
        });
        const credentialId = credential.id as number;
        await db`
          update channel_seats
          set credential_id = ${credentialId}
          where id = ${seat.id as number}
        `;

        secretIndex.set(secret, { channel, slot });
        const virtualKey = await createApiKey(
          phone,
          department!.id,
          productLineId,
          `pool-vk-${channel}-${slot}`,
        );
        products[channel][slot] = {
          productLineId,
          credentialId,
          secret,
          secretLabel: secretLabel(channel, slot),
          virtualKey,
        };
      }
    }

    const callerKey = await createApiKey(
      "13700002000",
      department!.id,
      products.glm.a.productLineId,
      "pool-vk-caller",
    );

    for (const channel of CHANNELS) {
      const perOwner = REQUESTS_PER_CHANNEL / 2;
      for (const slot of ["a", "b"] as const) {
        for (let i = 0; i < perOwner; i += 1) {
          const marker = `${channel}:${slot}:${i + 1}`;
          const res = await api.post("/ai/chat/completions", {
            headers: { Authorization: `Bearer ${products[channel][slot].virtualKey}` },
            data: {
              model: CHANNEL_MODEL[channel],
              messages: [{ role: "user", content: marker }],
              stream: false,
            },
          });
          requests.push({
            channel,
            model: CHANNEL_MODEL[channel],
            productLineId: null,
            credentialId: null,
            secretLabel: null,
            upstreamStatus: null,
            httpStatus: res.status(),
            marker,
          });
        }
      }
      const smokeMarker = `${channel}:caller:1`;
      const smokeRes = await api.post("/ai/chat/completions", {
        headers: { Authorization: `Bearer ${callerKey}` },
        data: {
          model: CHANNEL_MODEL[channel],
          messages: [{ role: "user", content: smokeMarker }],
          stream: false,
        },
      });
      requests.push({
        channel,
        model: CHANNEL_MODEL[channel],
        productLineId: null,
        credentialId: null,
        secretLabel: null,
        upstreamStatus: null,
        httpStatus: smokeRes.status(),
        marker: smokeMarker,
      });
    }

    const unknownRes = await api.post("/ai/chat/completions", {
      headers: { Authorization: `Bearer ${callerKey}` },
      data: {
        model: UNKNOWN_MODEL,
        messages: [{ role: "user", content: "unknown:prefix" }],
        stream: false,
      },
    });
    let code: string | null = null;
    try {
      const body = (await unknownRes.json()) as { error?: { code?: string } };
      code = body.error?.code ?? null;
    } catch {
      code = null;
    }
    unknownResult = { httpStatus: unknownRes.status(), code };

    const mockState = (await mockControl("state")) as MockState;
    for (const row of requests) {
      const hit = mockState.hits.find((item) => item.marker === row.marker);
      if (!hit) {
        row.upstreamStatus = null;
        continue;
      }
      const found = lookupSecret(hit.secret);
      row.upstreamStatus = 200;
      row.secretLabel = found?.secretLabel ?? hit.secret;
      if (found) {
        const product = products[found.channel][found.slot];
        row.productLineId = product.productLineId;
        row.credentialId = product.credentialId;
        row.secretLabel = product.secretLabel;
      }
    }
  });

  test.afterAll(async () => {
    writeArtifact();
    await mockControl("reset", {}).catch(() => {});
    await api?.dispose();
    await db?.end({ timeout: 5 });
  });

  test("prefixed requests stay in-channel and share one KEY pool per channel", () => {
    const relayed = requests.filter((row) => row.channel !== "unknown");
    expect(relayed.length, "should have recorded channel requests").toBeGreaterThan(0);
    for (const row of relayed) {
      expect(row.httpStatus, `${row.marker} should be served`).toBe(200);
      expect(
        row.secretLabel?.startsWith(`${row.channel}-`),
        `${row.marker} used ${row.secretLabel}, expected channel ${row.channel}`,
      ).toBe(true);
    }

    const labelsOf = (channel: ChannelCode) =>
      new Set(requests.filter((row) => row.channel === channel).map((row) => row.secretLabel));

    const glm = labelsOf("glm");
    expect(glm.has("glm-a"), `glm hits: ${[...glm].join(",")}`).toBe(true);
    expect(glm.has("glm-b"), `glm hits: ${[...glm].join(",")}`).toBe(true);

    const deepseek = labelsOf("deepseek");
    expect.soft(deepseek.has("deepseek-a"), `deepseek hits: ${[...deepseek].join(",")}`).toBe(true);
    expect.soft(deepseek.has("deepseek-b"), `deepseek hits: ${[...deepseek].join(",")}`).toBe(true);

    const huoshan = labelsOf("huoshan");
    expect.soft(huoshan.has("huoshan-a"), `huoshan hits: ${[...huoshan].join(",")}`).toBe(true);
    expect.soft(huoshan.has("huoshan-b"), `huoshan hits: ${[...huoshan].join(",")}`).toBe(true);

    expect(unknownResult, "unknown-prefix request should have run").toBeTruthy();
    expect(unknownResult!.httpStatus, "unknown prefix must not be served").not.toBe(200);
    expect(unknownResult!.code).toBe("model_not_allowed");
  });

  test("GET /api/admin/channel-types lists glm, deepseek, huoshan", () => {
    const rows = channelTypes as Array<{ code: string; productType: string }>;
    expect(rows.map((row) => row.code)).toEqual(["glm", "deepseek", "huoshan"]);
    expect(rows.map((row) => row.productType)).toEqual(["coding_plan", "api", "coding_plan"]);
  });
});
