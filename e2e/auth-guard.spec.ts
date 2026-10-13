import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * 未登录访问：管理端与个人端接口一律 401。
 * 新增需要登录的接口时把它加进这张表，不再为每个路由文件单独写 401 用例。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");

type Method = "GET" | "POST" | "PATCH" | "DELETE";

const PROTECTED: Array<[Method, string]> = [
  ["GET", "/api/admin/enterprises"],
  ["POST", "/api/admin/enterprises"],
  ["GET", "/api/admin/users"],
  ["POST", "/api/admin/users"],
  ["GET", "/api/admin/departments"],
  ["POST", "/api/admin/departments"],
  ["DELETE", "/api/admin/departments/1"],
  ["GET", "/api/admin/teams"],
  ["GET", "/api/admin/teams/1/members"],
  ["POST", "/api/admin/teams/1/members"],
  ["DELETE", "/api/admin/teams/1/members/9"],
  ["GET", "/api/admin/key-bindings"],
  ["GET", "/api/admin/key-bindings/live"],
  ["POST", "/api/admin/key-bindings/credentials/1/release"],
  ["GET", "/api/admin/model-prices"],
  ["GET", "/api/admin/logs"],
  ["GET", "/api/admin/error-logs"],
  ["GET", "/api/admin/user-analytics"],
  ["GET", "/api/admin/sensitive-words"],
  ["POST", "/api/admin/sensitive-words"],
  ["POST", "/api/admin/sensitive-words/import"],
  ["GET", "/api/admin/sensitive-word-hits"],
  ["GET", "/api/admin/settings"],
  ["GET", "/api/admin/channel-seats"],
  ["POST", "/api/admin/channel-seats"],
  ["PATCH", "/api/admin/channel-seats/1"],
  ["DELETE", "/api/admin/channel-seats/1"],
  ["DELETE", "/api/admin/product-lines/1"],
  ["GET", "/api/me/models"],
  ["GET", "/api/me/analytics"],
  ["GET", "/api/me/upstream-credential-channels"],
  ["GET", "/api/me/upstream-credentials"],
  ["POST", "/api/me/upstream-credentials"],
  ["POST", "/api/me/upstream-credentials/test"],
  ["DELETE", "/api/me/upstream-credentials/1"],
  ["POST", "/api/me/join-enterprise"],
  ["POST", "/api/me/enterprise-applications"],
  ["GET", "/api/support/status"],
  ["GET", "/api/support/history"],
  ["POST", "/api/support/chat"],
];

test("未登录访问管理端与个人端接口一律 401", async ({ request }) => {
  const results: Array<{ method: Method; url: string; status: number }> = [];
  for (const [method, url] of PROTECTED) {
    const res = await request.fetch(url, {
      method,
      ...(method === "GET" || method === "DELETE" ? {} : { data: {} }),
    });
    results.push({ method, url, status: res.status() });
  }

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(resolve(ARTIFACT_DIR, "auth-guard.json"), `${JSON.stringify(results, null, 2)}\n`);

  const leaked = results.filter((row) => row.status !== 401);
  expect(leaked, `这些接口未登录没有返回 401: ${JSON.stringify(leaked)}`).toEqual([]);
});
