import { expect, test } from "@playwright/test";
import { E2E } from "./env.ts";

test("账户登录：管理员进入后台工作台", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "登录 KodaX Fabric" })).toBeVisible();

  // 登录页默认 LDAP 模式，先切到账户登录。
  // Element Plus 的原生 radio 被样式 span 遮挡，点击可见文本更稳。
  await page.getByText("账户登录", { exact: true }).click();
  await page.getByPlaceholder("11 位手机号").fill(E2E.admin.phone);
  await page.getByPlaceholder("请输入密码").fill(E2E.admin.password);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
  await expect(page.getByText("企业管理").first()).toBeVisible();
});
