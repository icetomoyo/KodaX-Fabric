import { expect, test } from "@playwright/test";
import { SignJWT } from "jose";
import { E2E } from "./env.ts";

/**
 * 会话版本升级：此前签发的令牌（可能是凭共享初始密码拿到的）必须全部失效，
 * 已下线的批量注册、注册审核接口不再存在。
 */
test("会话版本升级前签发的令牌失效，当前登录签发的仍可用", async ({ request }) => {
  const login = await request.post("/api/auth/login", {
    data: { phone: E2E.admin.phone, password: E2E.admin.password },
  });
  const session = ((await login.json()) as { data: { token: string; user: { id: number } } }).data;
  const current = await request.get("/api/auth/me", {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  expect(current.status()).toBe(200);

  // 按升级前的格式签发：密钥、签名都对，只是没有版本号。
  const legacy = await new SignJWT({
    role: "admin",
    phone: E2E.admin.phone,
    name: E2E.admin.name,
    mustChangePassword: false,
    enterpriseId: null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(session.user.id))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(E2E.jwtSecret));
  const stale = await request.get("/api/auth/me", {
    headers: { Authorization: `Bearer ${legacy}` },
  });
  expect(stale.status()).toBe(401);
});

test("批量注册与注册审核接口已下线", async ({ request }) => {
  const login = await request.post("/api/auth/login", {
    data: { phone: E2E.admin.phone, password: E2E.admin.password },
  });
  const token = ((await login.json()) as { data: { token: string } }).data.token;
  const headers = { Authorization: `Bearer ${token}` };

  const imported = await request.post("/api/admin/users/import", {
    data: { users: [{ name: "不应创建", phone: "13800000039" }] },
    headers,
  });
  expect(imported.status()).toBe(404);
  const approved = await request.post("/api/admin/users/1/approve", { headers });
  expect(approved.status()).toBe(404);

  const shared = await request.post("/api/auth/login", {
    data: { phone: "13800000039", password: "Hz123456" },
  });
  expect(shared.status()).toBe(401);
});
