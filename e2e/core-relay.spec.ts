import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E } from "./env.ts";

/**
 * 核心业务闭环 E2E：
 * 管理员建企业/部门 → 批量注册员工并加入部门（部门默认团队自动承载）→
 * 建 haizhi 自建渠道（配置测试模型）→ 员工测试+提交渠道 KEY → 员工创建 API Key →
 * 通过 relay 调用 mock 上游 → 员工与管理员在页面上都能看到这次调用的 tokens 与积分。
 * 全程走真实 HTTP（经 vite 代理进真实 server），上游为本机 mock，可离线重复执行。
 */
const CLIENT_MODEL = "e2e-glm";
const UPSTREAM_MODEL = "e2e-upstream-model";
const UPSTREAM_SECRET = "sk-e2e-mock-secret";
const EMPLOYEE = { name: "E2E员工", phone: "13800000002", password: "Hz123456" };
const EXPECTED_TOTAL_TOKENS = 46;

const state: { employeeApiKey?: string } = {};

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

async function loginViaUi(page: Page, phone: string, password: string) {
  await page.goto("/");
  await page.getByText("账户登录", { exact: true }).click();
  await page.getByPlaceholder("11 位手机号").fill(phone);
  await page.getByPlaceholder("请输入密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(admin|me)/, { timeout: 15_000 });
}

async function getJson(ctx: APIRequestContext, url: string, token: string) {
  const res = await ctx.get(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { success?: boolean; data?: unknown; message?: string };
  expect(
    body.success === true,
    `GET ${url} 失败: ${res.status()} ${JSON.stringify(body)}`,
  ).toBeTruthy();
  return body.data as unknown;
}

test.describe.serial("核心闭环：渠道 → 席位 → 员工 Key → relay → 审计", () => {
  test("管理员搭建组织与渠道，员工提交 Key 并完成 relay 调用", async ({ request }) => {
    const admin = await loginToken(request, E2E.admin.phone, E2E.admin.password);

    // 1. 组织：企业 → 部门（部门自动带系统默认团队，团队不再是产品层级）
    const enterprise = await postJson(request, "/api/admin/enterprises", admin, { name: "E2E企业" });
    const department = await postJson(request, "/api/admin/departments", admin, {
      name: "E2E部门",
      enterpriseId: enterprise.id,
    });

    // 2. 员工：批量注册 → 加入部门（落到该部门的默认团队，自动归属企业）
    const imported = await postJson(request, "/api/admin/users/import", admin, {
      users: [{ name: EMPLOYEE.name, phone: EMPLOYEE.phone }],
    });
    const created = imported.created as Array<{ id: number; phone: string }>;
    expect(created, `员工应被创建: ${JSON.stringify(imported)}`).toHaveLength(1);
    const teamRows = (await getJson(
      request,
      `/api/admin/teams?departmentId=${department.id}`,
      admin,
    )) as Array<{ id: number; isDefault: boolean }>;
    const defaultTeam = teamRows.find((row) => row.isDefault);
    expect(defaultTeam, `部门应自动创建默认团队: ${JSON.stringify(teamRows)}`).toBeTruthy();
    await postJson(request, `/api/admin/teams/${defaultTeam!.id}/members`, admin, {
      employeeId: created[0].id,
    });

    // 3. 渠道：haizhi 自建，上游指向本机 mock（3311），并配置测试模型——
    //    自建渠道的「测试渠道 KEY」全靠这个模型名才能做连通性测试。
    const channel = await postJson(request, "/api/admin/product-lines", admin, {
      provider: "haizhi",
      name: "E2E自建渠道",
      tag: "E2E",
      seatCount: 1,
      status: "active",
      supportedProtocols: ["openai_chat"],
      protocolConfigs: {
        openai_chat: { baseUrl: `${E2E.mockUpstreamBaseUrl}/v1`, authStyle: "bearer" },
      },
      testModel: UPSTREAM_MODEL,
    });
    expect(channel.testModel, "创建响应应带回测试模型").toBe(UPSTREAM_MODEL);

    // 4. 模型路由：客户端模型 → 上游模型
    await postJson(request, "/api/admin/model-routes", admin, {
      clientModel: CLIENT_MODEL,
      productLineId: channel.id,
      upstreamModel: UPSTREAM_MODEL,
    });

    // 5. 席位：把员工绑定到渠道（员工提交渠道 KEY 的前提）
    const seat = await postJson(request, "/api/admin/channel-seats", admin, {
      employeeId: created[0].id,
      productLineId: channel.id,
      tag: "E2E",
    });

    // 6. 员工测试渠道 KEY → 拿 proof → 提交。
    //    本用例验证 testModel 打通了自建渠道的连通性测试（此前此处必然 400）。
    const employee = await loginToken(request, EMPLOYEE.phone, EMPLOYEE.password);
    const testResult = await postJson(request, "/api/me/upstream-credentials/test", employee, {
      seatId: seat.id,
      secret: UPSTREAM_SECRET,
    });
    expect(
      testResult.ok,
      `渠道 KEY 测试应使用渠道测试模型命中 mock 上游: ${JSON.stringify(testResult)}`,
    ).toBeTruthy();
    expect(typeof testResult.proof, "测试通过后应签发 proof").toBe("string");
    await postJson(request, "/api/me/upstream-credentials", employee, {
      seatId: seat.id,
      secret: UPSTREAM_SECRET,
      testProof: testResult.proof,
    });

    // 7. 员工创建 API Key（明文只返回一次）
    const apiKey = await postJson(request, "/api/me/api-keys", employee, {
      name: "E2E Key",
      departmentId: department.id,
      productLineId: channel.id,
      protocol: "openai_chat",
    });
    expect(typeof apiKey.key, "创建 API Key 应返回明文").toBe("string");
    state.employeeApiKey = apiKey.key as string;

    // 8. relay 调用：Bearer 员工 Key，走 /ai/chat/completions 命中 mock 上游
    const relayRes = await request.post("/ai/chat/completions", {
      headers: { Authorization: `Bearer ${state.employeeApiKey}` },
      data: {
        model: CLIENT_MODEL,
        messages: [{ role: "user", content: "E2E 核心闭环探活" }],
        stream: false,
      },
    });
    expect(relayRes.status(), `relay 调用失败: ${await relayRes.text()}`).toBe(200);
    const relayBody = (await relayRes.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    expect(relayBody.model, "relay 应把模型改写为上游模型").toBe(UPSTREAM_MODEL);
    expect(relayBody.choices?.[0]?.message?.content).toContain("E2E mock reply");
    expect(relayBody.usage?.total_tokens).toBe(EXPECTED_TOTAL_TOKENS);
    expect(relayRes.headers()["x-tokenhub-request-id"], "应返回审计 Request ID").toBeTruthy();
  });

  test("员工在调用记录页看到这次调用的 tokens 与积分", async ({ page }) => {
    await loginViaUi(page, EMPLOYEE.phone, EMPLOYEE.password);
    await page.goto("/me/logs");
    const row = page.getByRole("row", { name: new RegExp(CLIENT_MODEL) }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(String(EXPECTED_TOTAL_TOKENS));
  });

  test("管理员在调用日志页看到该员工的调用", async ({ page }) => {
    await loginViaUi(page, E2E.admin.phone, E2E.admin.password);
    await page.goto("/admin/logs");
    const row = page.getByRole("row", { name: new RegExp(CLIENT_MODEL) }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(EMPLOYEE.name);
    await expect(row).toContainText(String(EXPECTED_TOTAL_TOKENS));
  });
});
