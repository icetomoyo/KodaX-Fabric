import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACT_AS_KEY,
  TOKEN_KEY,
  USER_KEY,
  parseStoredActAs,
  parseStoredUser,
  readStoredSession,
} from "./session-storage.ts";

function fakeJwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `eyJhbGciOiJub25lIn0.${body}.sig`;
}

function installMemoryStorage() {
  const mem = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return mem.has(key) ? mem.get(key)! : null;
    },
    setItem(key: string, value: string) {
      mem.set(key, String(value));
    },
    removeItem(key: string) {
      mem.delete(key);
    },
    clear() {
      mem.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  return mem;
}

test("parseStoredUser rejects truncated JSON that used to crash login", () => {
  assert.equal(parseStoredUser("{"), null);
  assert.equal(parseStoredUser("undefined"), null);
  assert.equal(parseStoredUser(JSON.stringify({ name: "张伟" })), null);
  assert.deepEqual(
    parseStoredUser(JSON.stringify({ id: 6, role: "employee", name: "张伟" }))?.name,
    "张伟",
  );
});

test("readStoredSession drops leftover act-as when token/user are missing", () => {
  const mem = installMemoryStorage();
  mem.set(ACT_AS_KEY, JSON.stringify({ role: "employee", enterpriseId: 1, employeeId: 6 }));
  const empty = readStoredSession();
  assert.equal(empty.token, null);
  assert.equal(empty.actAs, null);
  assert.equal(mem.has(ACT_AS_KEY), false);
});

test("readStoredSession keeps a complete admin session including act-as", () => {
  installMemoryStorage();
  const token = fakeJwt({
    sub: "1",
    role: "admin",
    name: "管理员",
    mustChangePassword: false,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify({ id: 1, role: "admin", name: "管理员", mustChangePassword: false }));
  localStorage.setItem(ACT_AS_KEY, JSON.stringify({ role: "org_admin", enterpriseId: 2 }));
  const session = readStoredSession();
  assert.equal(session.token, token);
  assert.equal(session.user?.role, "admin");
  assert.equal(session.actAs?.role, "org_admin");
  assert.equal(session.actAs?.enterpriseId, 2);
});

test("readStoredSession heals mustChangePassword mismatch that caused the flash loop", () => {
  installMemoryStorage();
  const token = fakeJwt({
    sub: "1",
    role: "admin",
    name: "管理员",
    mustChangePassword: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(
    USER_KEY,
    JSON.stringify({ id: 1, role: "admin", name: "管理员", mustChangePassword: false }),
  );
  const session = readStoredSession();
  assert.equal(session.user?.mustChangePassword, true);
  assert.equal(JSON.parse(localStorage.getItem(USER_KEY)!).mustChangePassword, true);
});

test("readStoredSession drops leftover act-as on a non-admin token", () => {
  installMemoryStorage();
  const token = fakeJwt({
    sub: "6",
    role: "employee",
    name: "张伟",
    mustChangePassword: false,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify({ id: 6, role: "employee", name: "张伟" }));
  localStorage.setItem(ACT_AS_KEY, JSON.stringify({ role: "employee", enterpriseId: 1, employeeId: 6 }));
  const session = readStoredSession();
  assert.equal(session.actAs, null);
  assert.equal(localStorage.getItem(ACT_AS_KEY), null);
  assert.equal(session.token, token);
});

test("readStoredSession logs out an expired token instead of looping 401", () => {
  installMemoryStorage();
  const token = fakeJwt({
    sub: "1",
    role: "admin",
    mustChangePassword: false,
    exp: Math.floor(Date.now() / 1000) - 10,
  });
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify({ id: 1, role: "admin", name: "管理员" }));
  const session = readStoredSession();
  assert.equal(session.token, null);
  assert.equal(localStorage.getItem(TOKEN_KEY), null);
});

test("http interceptor records must-change-password before jumping pages", () => {
  const root = new URL(".", import.meta.url);
  const http = readFileSync(new URL("../api/http.ts", root), "utf8");
  const auth = readFileSync(new URL("../stores/auth.ts", root), "utf8");
  assert.match(auth, /function setSession[\s\S]*setActAs\(null\)/);
  assert.match(auth, /function markMustChangePassword/);
  assert.match(http, /auth\.markMustChangePassword\(\)/);
  assert.match(http, /location\.pathname !== "\/change-password"/);
});

test("parseStoredActAs rejects junk headers that would 400-reload", () => {
  assert.equal(parseStoredActAs("{"), null);
  assert.equal(parseStoredActAs(JSON.stringify({ role: "admin", enterpriseId: 1 })), null);
  assert.deepEqual(
    parseStoredActAs(JSON.stringify({ role: "employee", enterpriseId: 1, employeeId: 8 })),
    { role: "employee", enterpriseId: 1, departmentId: undefined, teamId: undefined, employeeId: 8 },
  );
});
