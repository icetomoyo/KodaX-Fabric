import { defineConfig } from "@playwright/test";
import { E2E, e2eServerEnv } from "./e2e/env.ts";

export default defineConfig({
  testDir: "./e2e",
  // 所有用例共享同一个测试库，串行执行避免互相污染数据。
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    // 主产物：自包含 HTML 报告（npm run test:e2e:report）。
    ["html", { outputFolder: "playwright-report", open: "never" }],
    // 机器可读结果，供后续 CI 消费。
    ["json", { outputFile: "e2e-results.json" }],
  ],
  use: {
    baseURL: E2E.webBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      // 建库 → 重置 → 迁移 → seed → 起服，顺序确定；库/账号约定见 e2e/env.ts。
      command:
        "npx tsx ../e2e/ensure-db.ts && npx tsx ../e2e/reset-db.ts && npm run db:migrate && npm run db:seed && npx tsx src/index.ts",
      cwd: "./server",
      env: { ...process.env, ...e2eServerEnv() },
      url: `${E2E.apiBaseUrl}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
    },
    {
      // OpenAI 兼容 mock 上游，承接渠道连通性测试与 relay 转发。
      command: "npx tsx e2e/mock-upstream.ts",
      cwd: ".",
      env: { ...process.env },
      url: E2E.mockUpstreamBaseUrl,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
    },
    {
      command: `npx vite --port ${E2E.webPort} --strictPort`,
      cwd: "./web",
      env: { ...process.env, DEV_API_TARGET: E2E.apiBaseUrl },
      url: E2E.webBaseUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
    },
  ],
});
