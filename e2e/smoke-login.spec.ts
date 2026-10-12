import { expect, test } from "@playwright/test";
import { REGISTRATION_INITIAL_PASSWORD } from "../server/src/lib/password.ts";
import { E2E } from "./env.ts";
import { E2E_ORG } from "./org-fixture.ts";

test("登录页可点钉钉登录，未配置时提示未配置钉钉登录", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "登录 KodaX Fabric" })).toBeVisible();
  await page.getByText("钉钉登录", { exact: true }).click();
  await page.getByRole("button", { name: "打开钉钉扫码" }).click();
  await expect(page.getByText("未配置钉钉登录")).toBeVisible();
  await expect(page).toHaveURL(/\/login\/?$/);
});

test("初始密码账户登录需员工确认后才跳转钉钉", async ({ page }) => {
  await page.goto("/");
  await page.getByText("账户登录", { exact: true }).click();
  await page.getByPlaceholder("11 位手机号").fill(E2E_ORG.employees.childA.phone);
  await page.getByPlaceholder("请输入密码").fill(REGISTRATION_INITIAL_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("是否前往钉钉认证")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page).toHaveURL(/\/login\/?$/);
  await expect(page.getByText("未配置钉钉登录")).toHaveCount(0);

  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "前往钉钉认证" }).click();
  await expect(page.getByText("未配置钉钉登录")).toBeVisible();
  await expect(page).toHaveURL(/\/login\/?$/);
});

test("账户登录：管理员进入后台工作台", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "登录 KodaX Fabric" })).toBeVisible();

  // 登录页默认钉钉登录，先切到账户登录。
  // Element Plus 的原生 radio 被样式 span 遮挡，点击可见文本更稳。
  await page.getByText("账户登录", { exact: true }).click();
  await page.getByPlaceholder("11 位手机号").fill(E2E.admin.phone);
  await page.getByPlaceholder("请输入密码").fill(E2E.admin.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
  await expect(page.getByText("企业管理").first()).toBeVisible();
});

test("KEYS看板渲染六条状态泳道", async ({ page }) => {
  await page.goto("/");
  await page.getByText("账户登录", { exact: true }).click();
  await page.getByPlaceholder("11 位手机号").fill(E2E.admin.phone);
  await page.getByPlaceholder("请输入密码").fill(E2E.admin.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });

  await page.goto("/admin/keys-board");
  for (const lane of ["等候", "使用", "5 小时冷却", "7 天冷却", "限流", "停用"]) {
    await expect(page.locator(".kanban-column-title", { hasText: lane })).toBeVisible();
  }
  await expect(page.getByText("个 Key").first()).toBeVisible();
});
