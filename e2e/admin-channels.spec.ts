import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./env.ts";
import { E2E_ORG } from "./org-fixture.ts";

/**
 * Admin channel plugins: 渠道 from code, 产品 (not 模式), no 新增渠道,
 * no 套餐/充值 selector. GLM / DeepSeek / 火山方舟 each have their own page.
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");
const stamp = Date.now();

async function loginAdmin(page: Page) {
  await page.goto("/");
  await page.getByText("账户登录", { exact: true }).click();
  await page.getByPlaceholder("11 位手机号").fill(E2E.admin.phone);
  await page.getByPlaceholder("请输入密码").fill(E2E.admin.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
}

async function openChannels(page: Page) {
  await page.goto("/admin/temp-channels");
  await expect(page.locator(".channel-list .item-card", { hasText: "智谱" })).toBeVisible({
    timeout: 15_000,
  });
}

async function selectChannel(page: Page, company: string) {
  await page.locator(".channel-list .item-card", { hasText: company }).click();
}

async function createProduct(page: Page, addButton: string, name: string) {
  await page.getByRole("button", { name: addButton }).click();
  const dialog = page.locator(".el-dialog").filter({ hasText: addButton });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "套餐" })).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "充值" })).toHaveCount(0);
  await dialog.getByPlaceholder(/例如/).fill(name);
  await dialog.getByRole("button", { name: "创建" }).click();
  await expect(page.getByText("产品已创建")).toBeVisible();
  await expect(page.locator(".item-card", { hasText: name })).toBeVisible();
}

test.beforeAll(() => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
});

test("上游渠道页列出三个插件渠道，没有新增渠道和模式", async ({ page }) => {
  await loginAdmin(page);
  await openChannels(page);

  const companies = page.locator(".channel-list .item-card .item-title");
  await expect(companies).toHaveCount(3);
  await expect(companies.nth(0)).toContainText("智谱");
  await expect(companies.nth(1)).toContainText("深度求索");
  await expect(companies.nth(2)).toContainText("火山方舟");
  await expect(page.getByRole("button", { name: "新增渠道" })).toHaveCount(0);
  await expect(page.getByText("模式")).toHaveCount(0);

  await page.screenshot({
    path: resolve(ARTIFACT_DIR, "admin-channels-glm.png"),
    fullPage: true,
  });
});

test("智谱：新增套餐、席位，右侧只有席位表", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAdmin(page);
  await openChannels(page);
  await selectChannel(page, "智谱");

  await page.getByRole("button", { name: "新增套餐" }).click();
  const dialog = page.locator(".el-dialog").filter({ hasText: "新增套餐" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "套餐" })).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "充值" })).toHaveCount(0);
  await dialog.screenshot({
    path: resolve(ARTIFACT_DIR, "admin-channels-glm-create-dialog.png"),
  });

  const productName = `E2E-GLM产品-${stamp}`;
  await dialog.getByPlaceholder("例如 GLM-50").fill(productName);
  await dialog.getByRole("button", { name: "创建" }).click();
  await expect(page.getByText("产品已创建")).toBeVisible();
  await page.locator(".item-card", { hasText: productName }).click();

  await page.getByRole("button", { name: "新增席位" }).click();
  const seatDialog = page.getByRole("dialog", { name: "新增席位" });
  await expect(seatDialog).toBeVisible();
  await seatDialog.getByRole("combobox").click();
  await seatDialog.getByRole("combobox").fill(E2E_ORG.employees.childA.name);
  await page.getByRole("option", { name: new RegExp(E2E_ORG.employees.childA.name) }).click();
  await seatDialog.getByRole("button", { name: "登记" }).click();
  await expect(page.getByText("已登记席位")).toBeVisible();
  await expect(seatDialog).toBeHidden();
  await expect(
    page.getByRole("cell", { name: E2E_ORG.employees.childA.name, exact: true }),
  ).toBeVisible();

  const detail = page.locator(".detail-pane");
  await expect(detail.locator(".pane-label", { hasText: "席位" })).toBeVisible();
  await expect(detail.locator(".pane-label", { hasText: /^KEY$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "添加 KEY" })).toHaveCount(0);
  await page.screenshot({
    path: resolve(ARTIFACT_DIR, "admin-channels-glm-seats-only.png"),
    fullPage: true,
  });
});

test("深度求索：新增充值账户", async ({ page }) => {
  await loginAdmin(page);
  await openChannels(page);
  await selectChannel(page, "深度求索");
  await expect(page.getByRole("button", { name: "新增充值账户" })).toBeVisible();

  const productName = `E2E-DS账户-${stamp}`;
  await createProduct(page, "新增充值账户", productName);
  const dialog = page.locator(".el-dialog").filter({ hasText: "新增充值账户" });
  await expect(dialog).toBeHidden();
  await expect(page.locator(".el-overlay:visible")).toHaveCount(0);
  await expect(page.locator(".el-message")).toHaveCount(0);

  await page.screenshot({
    path: resolve(ARTIFACT_DIR, "admin-channels-deepseek.png"),
    fullPage: true,
  });
});

test("火山方舟：新增套餐（无既有产品也能创建）", async ({ page }) => {
  await loginAdmin(page);
  await openChannels(page);
  await selectChannel(page, "火山方舟");
  await expect(page.getByRole("button", { name: "新增套餐" })).toBeVisible();

  const productName = `E2E-HS套餐-${stamp}`;
  await createProduct(page, "新增套餐", productName);
  const dialog = page.locator(".el-dialog").filter({ hasText: "新增套餐" });
  await expect(dialog).toBeHidden();
  await expect(page.locator(".el-overlay:visible")).toHaveCount(0);
  await expect(page.locator(".el-message")).toHaveCount(0);

  const detail = page.locator(".detail-pane");
  await expect(detail.locator(".pane-label", { hasText: "席位" })).toBeVisible();
  await expect(detail.locator(".pane-label", { hasText: /^KEY$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "添加 KEY" })).toHaveCount(0);

  await page.screenshot({
    path: resolve(ARTIFACT_DIR, "admin-channels-huoshan.png"),
    fullPage: true,
  });
});
