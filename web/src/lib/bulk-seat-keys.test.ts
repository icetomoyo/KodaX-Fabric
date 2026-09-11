import assert from "node:assert/strict";
import test from "node:test";
import { maskSeatKeySecret, parseBulkSeatKeysText } from "./bulk-seat-keys.ts";

test("bulk seat keys paste accepts space, comma, and tab separated name plus key", () => {
  const parsed = parseBulkSeatKeysText(
    "姓名 渠道KEY\n张三 abcdefghijkl\n李四\tABCDEFGH1234\n王五,sk-12345678\n\n",
  );
  assert.deepEqual(
    parsed.entries.map((row) => ({ name: row.name, secret: row.secret })),
    [
      { name: "张三", secret: "abcdefghijkl" },
      { name: "李四", secret: "ABCDEFGH1234" },
      { name: "王五", secret: "sk-12345678" },
    ],
  );
  assert.deepEqual(parsed.errors, []);
});

test("bulk seat keys paste reports missing fields and in-batch duplicates", () => {
  const parsed = parseBulkSeatKeysText(
    "只有姓名\n,sk-12345678\n张三,short\n张三,sk-12345678\n李四,sk-12345678",
  );
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0]?.name, "张三");
  assert.match(parsed.errors.join("\n"), /第 1 行：请同时填写姓名和渠道 KEY/);
  assert.match(parsed.errors.join("\n"), /第 2 行：姓名不能为空/);
  assert.match(parsed.errors.join("\n"), /第 3 行：渠道 KEY 长度应为/);
  assert.match(parsed.errors.join("\n"), /第 5 行：与第 4 行渠道 KEY 重复/);
});

test("maskSeatKeySecret keeps the last four characters", () => {
  assert.equal(maskSeatKeySecret("abcdefghijkl"), "•••• ijkl");
});
