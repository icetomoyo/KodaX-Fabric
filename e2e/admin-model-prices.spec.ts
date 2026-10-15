import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./env.ts";

/**
 * 超管「模型列表」：模型名称 / 模型类型 / 积分消耗。不要最近使用，不要图片/视频标签。
 *
 * 可能出错的方式：
 *  1. 表头仍是「模型」或还留着「最近使用」。
 *  2. 模型名称旁还渲染图片/视频标签。
 *  3. glm-5.3 不是纯文本，glm-5.3-flash 不是多模态。
 *  4. 火山 Agent Plan 12 个模型：文本按能力标纯文本/多模态，embedding 为向量。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");

type CatalogModel = {
  model: string;
  kind?: string;
  creditRate?: { promptCreditsPer10k: string } | null;
};

type CatalogChannel = {
  providerCode: string;
  models: CatalogModel[];
};

async function loginAdmin(page: Page) {
  await page.goto("/");
  await page.getByText("账户登录", { exact: true }).click();
  await page.getByPlaceholder("11 位手机号").fill(E2E.admin.phone);
  await page.getByPlaceholder("请输入密码").fill(E2E.admin.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
}

test("超管模型列表展示模型名称与模型类型", async ({ page }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  await loginAdmin(page);

  const token = await page.evaluate(() => localStorage.getItem("th_token"));
  expect(token, "登录后应写入 th_token").toBeTruthy();
  const res = await page.request.get("/api/admin/model-prices", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { success?: boolean; data?: { channels?: CatalogChannel[] } };
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  const channels = body.data?.channels ?? [];

  for (const channel of channels) {
    for (const row of channel.models) {
      expect(row, JSON.stringify(row)).not.toHaveProperty("tags");
      expect(row, JSON.stringify(row)).not.toHaveProperty("lastUsedAt");
    }
    if (channel.providerCode === "glm") {
      const text = channel.models.find((row) => row.model.endsWith("glm-5.3") && !row.model.includes("flash"));
      expect(text?.kind).toBe("纯文本");
      const flash = channel.models.find((row) => row.model.endsWith("glm-5.3-flash"));
      expect(flash?.kind).toBe("多模态");
    } else if (channel.providerCode === "huoshan") {
      expect(channel.models).toHaveLength(12);
      expect(channel.models.some((row) => row.model.includes("kimi-k2.7-code"))).toBe(true);
      expect(channel.models.some((row) => row.model.includes("kimi-k3"))).toBe(false);
      const flash = channel.models.find((row) => row.model.endsWith("glm-5.3-flash"));
      expect(flash?.kind).toBe("多模态");
      const embedding = channel.models.find((row) => row.model.includes("embedding"));
      expect(embedding?.kind).toBe("向量");
    } else if (channel.providerCode === "deepseek") {
      for (const row of channel.models) expect(row.kind).toBe("纯文本");
    }
  }

  await page.goto("/admin/model-prices");
  await expect(page.getByRole("columnheader", { name: "模型名称" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "模型类型" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "最近使用" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "模型", exact: true })).toHaveCount(0);

  const glm = page.locator("button.channel-item", { hasText: "智谱" }).first();
  if (await glm.count()) {
    await glm.click();
    const textRow = page.locator(".el-table__row").filter({ hasText: "glm-5.3" }).filter({ hasNotText: "flash" });
    await expect(textRow).toContainText("纯文本");
    await expect(textRow.getByText("图片")).toHaveCount(0);
    const flashRow = page.locator(".el-table__row", { hasText: "glm-5.3-flash" });
    await expect(flashRow).toContainText("多模态");
    await expect(flashRow.getByText("图片")).toHaveCount(0);
    await expect(flashRow.getByText("视频")).toHaveCount(0);
  }

  await page.screenshot({ path: resolve(ARTIFACT_DIR, "admin-model-prices.png"), fullPage: true });
});
