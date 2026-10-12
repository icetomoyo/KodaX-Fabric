import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E } from "./env.ts";

/**
 * 超管工作台的日志存储空间：
 * 往请求全文目录里放已知大小的文件 → 触发统计 → 接口给出的占用、文件数、日均增长与落盘一致 →
 * 已过去的日期沿用上一轮结果，整天目录被清掉后占用归零 → 工作台页面展示这块区域。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");
const ROOT = E2E.requestContextDir;

type Report = {
  disk: { totalBytes: number; usedBytes: number; freeBytes: number } | null;
  logs: {
    bytes: number;
    files: number;
    scannedAt: string;
    recentDays: Array<{ day: string; bytes: number }>;
    dailyGrowthBytes: number | null;
    daysLeft: number | null;
  } | null;
  scanning: boolean;
};

function seed(path: string, bytes: number): number {
  const target = resolve(ROOT, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.alloc(bytes, 7));
  return statSync(target).blocks * 512;
}

async function adminToken(ctx: APIRequestContext) {
  const res = await ctx.post("/api/auth/login", {
    data: { phone: E2E.admin.phone, password: E2E.admin.password },
  });
  return ((await res.json()) as { data: { token: string } }).data.token;
}

/** 触发统计并等它跑完，返回这一轮的结果。 */
async function rescan(ctx: APIRequestContext, token: string, after?: string): Promise<Report> {
  const headers = { Authorization: `Bearer ${token}` };
  let report: Report | undefined;
  await expect
    .poll(
      async () => {
        const fresh = report?.logs && report.logs.scannedAt !== after && !report.scanning;
        if (!fresh) await ctx.post("/api/admin/storage/rescan", { headers });
        const res = await ctx.get("/api/admin/storage", { headers });
        report = ((await res.json()) as { data: Report }).data;
        return Boolean(report.logs && !report.scanning && report.logs.scannedAt !== after);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return report!;
}

function dayBytes(report: Report, day: string) {
  return report.logs!.recentDays.find((row) => row.day === day)?.bytes;
}

test.describe.serial("日志存储空间", () => {
  test("统计结果与落盘一致，封存日期沿用缓存，目录清掉后归零", async ({ request }) => {
    const token = await adminToken(request);
    rmSync(ROOT, { recursive: true, force: true });

    const empty = await rescan(request, token);
    expect(empty.logs!.bytes, "空目录按 0 统计，不报错").toBe(0);
    expect(empty.logs!.dailyGrowthBytes, "没有历史时不给增速").toBeNull();
    expect(empty.disk!.totalBytes).toBeGreaterThan(empty.disk!.usedBytes);
    expect(empty.disk!.freeBytes).toBeGreaterThan(0);

    const days = empty.logs!.recentDays.map((row) => row.day);
    const today = days[days.length - 1];
    const twoDaysAgo = days[days.length - 3];
    const fiveDaysAgo = days[days.length - 6];

    const legacy = seed(`${fiveDaysAgo}/seed-legacy.json.gz`, 8192);
    const perUser = seed(`users/999001/${twoDaysAgo}/seed-user.json.gz`, 4096);
    const blob = seed("files/ab/seed-blob", 4096);

    const first = await rescan(request, token, empty.logs!.scannedAt);
    expect(first.logs!.files).toBe(3);
    expect(first.logs!.bytes).toBe(legacy + perUser + blob);
    expect(dayBytes(first, fiveDaysAgo)).toBe(legacy);
    expect(dayBytes(first, twoDaysAgo)).toBe(perUser);
    expect(dayBytes(first, today), "去重存储按文件修改日期归到今天").toBe(blob);
    // 今天还没过完，不计入增速。
    expect(first.logs!.dailyGrowthBytes).toBe(Math.round((legacy + perUser) / 7));
    expect(first.logs!.daysLeft).toBeGreaterThan(0);

    // 已过去的日期不重新量：往里再写文件，结果不变。
    seed(`${fiveDaysAgo}/late-write.json.gz`, 8192);
    const sealed = await rescan(request, token, first.logs!.scannedAt);
    expect(dayBytes(sealed, fiveDaysAgo)).toBe(legacy);

    // 整天的目录被清理后，占用跟着归零。
    rmSync(resolve(ROOT, fiveDaysAgo), { recursive: true, force: true });
    const cleaned = await rescan(request, token, sealed.logs!.scannedAt);
    expect(dayBytes(cleaned, fiveDaysAgo)).toBe(0);
    expect(cleaned.logs!.bytes).toBe(perUser + blob);

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(
      resolve(ARTIFACT_DIR, "log-storage.json"),
      `${JSON.stringify({ seeded: { legacy, perUser, blob }, first, sealed, cleaned }, null, 2)}\n`,
    );
  });

  test("只有超级管理员能读取", async ({ request }) => {
    const anonymous = await request.get("/api/admin/storage");
    expect(anonymous.status()).toBe(401);

    const employee = { name: "存储越权", phone: "13800000041", password: "E2eStore@2026" };
    await request.post("/api/auth/register", { data: employee });
    const login = await request.post("/api/auth/login", {
      data: { phone: employee.phone, password: employee.password },
    });
    const token = ((await login.json()) as { data: { token: string } }).data.token;
    const headers = { Authorization: `Bearer ${token}` };
    expect((await request.get("/api/admin/storage", { headers })).status()).toBe(403);
    expect((await request.post("/api/admin/storage/rescan", { headers })).status()).toBe(403);
  });

  test("超管工作台展示日志存储空间", async ({ page }) => {
    await page.goto("/");
    await page.getByText("账户登录", { exact: true }).click();
    await page.getByPlaceholder("11 位手机号").fill(E2E.admin.phone);
    await page.getByPlaceholder("请输入密码").fill(E2E.admin.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });

    const card = page.getByTestId("log-storage");
    await expect(card.getByText("日志存储空间")).toBeVisible();
    await expect(card.getByText("磁盘已用")).toBeVisible();
    await expect(card.getByText("请求日志占用")).toBeVisible();
    await expect(card.getByText("2 个文件")).toBeVisible();
    await expect(card.getByText(/约可再用 [\d+]+ 天（估算）/)).toBeVisible();

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await card.screenshot({ path: resolve(ARTIFACT_DIR, "log-storage.png") });
  });
});
