import assert from "node:assert/strict";
import test from "node:test";
import { parseBulkRegisterText } from "./bulk-register-users.ts";

test("bulk register paste accepts comma, tab, and space separated name plus phone", () => {
  const parsed = parseBulkRegisterText(
    "姓名,手机号\n张三,13800138000\n李四\t13900139000\n王五 13700137000\n\n",
  );
  assert.deepEqual(
    parsed.users.map((row) => ({ name: row.name, phone: row.phone })),
    [
      { name: "张三", phone: "13800138000" },
      { name: "李四", phone: "13900139000" },
      { name: "王五", phone: "13700137000" },
    ],
  );
  assert.deepEqual(parsed.errors, []);
});

test("bulk register paste reports missing fields and in-batch duplicate phones", () => {
  const parsed = parseBulkRegisterText(
    "只有姓名\n,13800138000\n张三,138\n张三,13800138000\n李四,13800138000",
  );
  assert.equal(parsed.users.length, 1);
  assert.equal(parsed.users[0]?.phone, "13800138000");
  assert.match(parsed.errors.join("\n"), /第 1 行：请同时填写姓名和手机号/);
  assert.match(parsed.errors.join("\n"), /第 2 行：姓名不能为空/);
  assert.match(parsed.errors.join("\n"), /第 3 行：手机号长度应为 5–20 个字符/);
  assert.match(parsed.errors.join("\n"), /第 5 行：与第 4 行手机号重复/);
});
