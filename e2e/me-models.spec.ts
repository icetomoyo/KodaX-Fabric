import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { SCHED_LOGIN_PASSWORD, SCHED_PEOPLE } from "./scheduling-fixture.ts";

/**
 * 员工「模型列表」与超管模型列表同一套列：模型名称 / 模型类型 / 积分消耗。
 * 名称后面多一个复制按钮。
 *
 * 可能出错的方式：
 *  1. 表头还是单价/上下文/输入模态。
 *  2. 复制按钮不在模型名称后面。
 *  3. glm-5.3 不是纯文本，glm-5.3-flash 不是多模态。
 *  4. 积分列缺失，或 glm-5.3 Input 不是 6.9。
 *  5. 模型名称 / 模型类型筛选项缺失，或筛选后表格不跟着变。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");

type CatalogModel = {
  model: string;
  kind?: string;
  creditRate?: { promptCreditsPer10k: string; cacheHitCreditsPer10k: string; completionCreditsPer10k: string } | null;
};

type CatalogChannel = {
  providerCode: string;
  models: CatalogModel[];
};

async function loginViaUi(page: Page, phone: string, password: string) {
  await page.goto("/");
  await page.getByText("账户登录", { exact: true }).click();
  await page.getByPlaceholder("11 位手机号").fill(phone);
  await page.getByPlaceholder("请输入密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/(admin|me)/, { timeout: 15_000 });
}

test("员工模型列表展示模型类型与积分消耗，名称可复制", async ({ page }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const user = SCHED_PEOPLE.tdUser;
  await loginViaUi(page, user.phone, SCHED_LOGIN_PASSWORD);

  const token = await page.evaluate(() => localStorage.getItem("th_token"));
  expect(token, "登录后应写入 th_token").toBeTruthy();
  const res = await page.request.get("/api/me/models", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { success?: boolean; data?: { channels?: CatalogChannel[] } };
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  const channels = body.data?.channels ?? [];

  for (const channel of channels) {
    for (const row of channel.models) {
      expect(row, JSON.stringify(row)).not.toHaveProperty("modalities");
      expect(row, JSON.stringify(row)).not.toHaveProperty("cacheStorage");
    }
    if (channel.providerCode === "glm") {
      const text = channel.models.find((row) => row.model.endsWith("glm-5.3") && !row.model.includes("flash"));
      expect(text?.kind).toBe("纯文本");
      expect(text?.creditRate?.promptCreditsPer10k).toBe("6.9");
      const flash = channel.models.find((row) => row.model.endsWith("glm-5.3-flash"));
      expect(flash?.kind).toBe("多模态");
      expect(flash?.creditRate?.promptCreditsPer10k).toBe("2.3");
    } else if (channel.providerCode === "huoshan") {
      expect(channel.models).toHaveLength(10);
      expect(channel.models.some((row) => /\bglm/i.test(row.model))).toBe(false);
      expect(channel.models.some((row) => row.model.includes("kimi-k2.7-code"))).toBe(true);
      expect(channel.models.some((row) => row.model.includes("kimi-k3"))).toBe(false);
      const mini = channel.models.find((row) => row.model.endsWith("doubao-seed-2.0-mini"));
      expect(mini?.kind).toBe("多模态");
      const text = channel.models.find((row) => row.model.endsWith("deepseek-v4-flash"));
      expect(text?.kind).toBe("纯文本");
      const embedding = channel.models.find((row) => row.model.includes("embedding"));
      expect(embedding?.kind).toBe("向量");
    }
  }

  await page.goto("/me/models");
  await expect(page.getByRole("columnheader", { name: "模型名称" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "模型类型" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Input", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Cached Input" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Output" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "上下文" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "输入模态" })).toHaveCount(0);

  const glm = page.locator("button.channel-item", { hasText: "智谱" }).first();
  if (await glm.count()) {
    await glm.click();
    const textRow = page.locator(".el-table__row").filter({ hasText: "glm-5.3" }).filter({ hasNotText: "flash" });
    await expect(textRow).toBeVisible();
    await expect(textRow.getByRole("button", { name: "复制" })).toBeVisible();
    await expect(textRow).toContainText("纯文本");
    await expect(textRow).toContainText("6.9");
    const flashRow = page.locator(".el-table__row", { hasText: "glm-5.3-flash" });
    await expect(flashRow).toContainText("多模态");
    await expect(flashRow.getByRole("button", { name: "复制" })).toBeVisible();
    await flashRow.getByRole("button", { name: "复制" }).click();
    await expect(page.getByText(/已复制/)).toBeVisible();

    await expect(page.getByPlaceholder("模型名称")).toBeVisible();
    await expect(page.locator(".kind-filter")).toBeVisible();
    await page.locator(".kind-filter").click();
    await page.getByRole("option", { name: "纯文本" }).click();
    await expect(textRow).toBeVisible();
    await expect(page.locator(".el-table__row", { hasText: "glm-5.3-flash" })).toHaveCount(0);
    const kindSelect = page.locator(".kind-filter");
    await kindSelect.hover();
    await kindSelect.locator(".el-select__clear").click({ force: true });
    await page.getByPlaceholder("模型名称").fill("glm-5.3-flash");
    await expect(page.locator(".el-table__row", { hasText: "glm-5.3-flash" })).toBeVisible();
    await expect(page.locator(".el-table__row").filter({ hasText: "glm-5.3" }).filter({ hasNotText: "flash" })).toHaveCount(0);
    await page.getByPlaceholder("模型名称").clear();
  }

  const huoshan = page.locator("button.channel-item", { hasText: "火山" }).first();
  if (await huoshan.count()) {
    await huoshan.click();
    await expect(page.locator(".el-table__row", { hasText: "glm-5.3" })).toHaveCount(0);
    await page.locator(".kind-filter").click();
    await page.getByRole("option", { name: "向量" }).click();
    const embeddingRow = page.locator(".el-table__row", { hasText: "embedding" });
    await expect(embeddingRow).toBeVisible();
    await expect(embeddingRow).toContainText("向量");
    await expect(page.locator(".el-table__row")).toHaveCount(1);
  }

  await page.screenshot({ path: resolve(ARTIFACT_DIR, "me-models.png"), fullPage: true });
});
