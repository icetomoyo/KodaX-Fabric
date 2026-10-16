import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";
import { E2E } from "./env.ts";
import { SCHED_LOGIN_PASSWORD, SCHED_PEOPLE } from "./scheduling-fixture.ts";

/**
 * GET /v1/models 必须和员工「模型列表」页（GET /api/me/models）是同一份目录。
 * 生产上 th_ Key 绑在智谱套餐时，/v1/models 只回了 glm/*，页面上却有火山方舟。
 *
 * 可能出错的方式：
 *  1. GLM 绑定的 Key 调 /v1/models 只列出 glm/*，丢掉 huoshan/*。
 *  2. 两边的 id 集合不相等（多了、少了、或前缀写法不一致）。
 *  3. /me/models 已经能看到 huoshan/doubao-seed-2.0-mini，/v1/models 没有这条。
 *  4. 空目录回 503 bound_channel_unavailable，而不是 {object:list, data:[]}。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");
const KEY_NAME = "v1-models GLM-bound";

type CatalogChannel = {
  providerCode: string;
  models: Array<{ model: string }>;
};

async function loginToken(ctx: APIRequestContext, phone: string, password: string) {
  const res = await ctx.post("/api/auth/login", { data: { phone, password } });
  const body = (await res.json()) as { success?: boolean; data?: { token?: string } };
  expect(
    body.success === true && typeof body.data?.token === "string",
    `登录失败 ${phone}: ${JSON.stringify(body)}`,
  ).toBeTruthy();
  return body.data!.token as string;
}

async function postJson(ctx: APIRequestContext, url: string, token: string, data: unknown) {
  const res = await ctx.post(url, {
    data,
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { success?: boolean; data?: unknown; message?: string };
  expect(
    body.success === true,
    `POST ${url} 失败: ${res.status()} ${JSON.stringify(body)}`,
  ).toBeTruthy();
  return body.data as Record<string, unknown>;
}

test("GLM 绑定的 th_ Key，GET /v1/models 与 /me/models 目录一致且含火山", async ({ request }) => {
  const sql = postgres(E2E.databaseUrl, { max: 1 });
  const lineIds: number[] = [];
  try {
    const admin = await loginToken(request, E2E.admin.phone, E2E.admin.password);

    const glmLine = await postJson(request, "/api/admin/product-lines", admin, {
      provider: "glm",
      variant: "domestic",
      name: "v1-models GLM",
      tag: "v1-models",
      seatCount: 1,
      status: "active",
      supportedProtocols: ["openai_chat"],
      productType: "coding_plan",
    });
    lineIds.push(Number(glmLine.id));
    await postJson(request, "/api/admin/credentials", admin, {
      productLineId: Number(glmLine.id),
      label: "v1-models-glm",
      secret: "sk-v1-models-glm-secret",
    });

    const huoshanLine = await postJson(request, "/api/admin/product-lines", admin, {
      provider: "huoshan",
      productType: "coding_plan",
      name: "v1-models 方舟",
      tag: "v1-models",
      seatCount: 1,
      status: "active",
      supportedProtocols: ["openai_chat"],
    });
    lineIds.push(Number(huoshanLine.id));
    await postJson(request, "/api/admin/credentials", admin, {
      productLineId: Number(huoshanLine.id),
      label: "v1-models-huoshan",
      secret: "sk-v1-models-huoshan-secret",
    });

    const employee = await loginToken(
      request,
      SCHED_PEOPLE.tdUser.phone,
      SCHED_LOGIN_PASSWORD,
    );
    const orgRes = await request.get("/api/me/org", {
      headers: { Authorization: `Bearer ${employee}` },
    });
    const org = (await orgRes.json()) as {
      success?: boolean;
      data?: { departments?: Array<{ id: number }> };
    };
    const departmentId = org.data?.departments?.[0]?.id;
    expect(departmentId, `潮汐-被授权员工应有部门: ${JSON.stringify(org)}`).toBeTruthy();

    const meRes = await request.get("/api/me/models", {
      headers: { Authorization: `Bearer ${employee}` },
    });
    const meBody = (await meRes.json()) as {
      success?: boolean;
      data?: { channels?: CatalogChannel[] };
    };
    expect(meBody.success, JSON.stringify(meBody)).toBeTruthy();
    const channels = meBody.data?.channels ?? [];
    const meIds = [...new Set(channels.flatMap((channel) => channel.models.map((row) => row.model)))].sort();
    expect(meIds.some((id) => id.startsWith("glm/")), `页面目录应有智谱: ${meIds.join(",")}`).toBe(true);
    expect(
      meIds.includes("huoshan/doubao-seed-2.0-mini"),
      `页面目录应有火山 doubao-seed-2.0-mini: ${meIds.join(",")}`,
    ).toBe(true);

    const created = await postJson(request, "/api/me/api-keys", employee, {
      name: KEY_NAME,
      departmentId,
      productLineId: Number(glmLine.id),
      protocol: "openai_chat",
    });
    const thKey = created.key as string;
    expect(typeof thKey, "创建 API Key 应返回明文").toBe("string");

    const keysRes = await request.get("/api/me/api-keys", {
      headers: { Authorization: `Bearer ${employee}` },
    });
    const keysBody = (await keysRes.json()) as {
      data?: Array<{ name: string; providerCode: string }>;
    };
    const bound = keysBody.data?.find((row) => row.name === KEY_NAME);
    expect(bound?.providerCode, "这条 Key 必须绑在智谱渠道上").toBe("glm");

    const v1Res = await request.get("/v1/models", {
      headers: { Authorization: `Bearer ${thKey}` },
    });
    expect(v1Res.status(), await v1Res.text()).toBe(200);
    const v1Body = (await v1Res.json()) as {
      object?: string;
      data?: Array<{ id: string; owned_by?: string }>;
    };
    expect(v1Body.object).toBe("list");
    const v1Ids = [...new Set((v1Body.data ?? []).map((row) => row.id))].sort();

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(
      resolve(ARTIFACT_DIR, "v1-models.json"),
      `${JSON.stringify({
        boundProvider: bound?.providerCode,
        meIds,
        v1Ids,
      }, null, 2)}\n`,
    );

    expect(v1Ids, "/v1/models 应含火山模型").toContain("huoshan/doubao-seed-2.0-mini");
    expect(v1Ids, "GET /v1/models 与 /api/me/models 的模型 id 必须相同").toEqual(meIds);
  } finally {
    for (const lineId of lineIds) {
      await sql`update product_lines set status = 'disabled' where id = ${lineId}`;
      await sql`update upstream_credentials set status = 'disabled', cool_until = null where product_line_id = ${lineId}`;
    }
    await sql.end({ timeout: 5 });
  }
});
