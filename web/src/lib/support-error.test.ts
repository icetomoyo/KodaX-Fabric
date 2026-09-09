import assert from "node:assert/strict";
import test from "node:test";
import { readSupportErrorBody } from "./support-error.ts";

test("readSupportErrorBody prefers nested support API error.message", () => {
  assert.equal(
    readSupportErrorBody({
      success: false,
      error: { code: "SUPPORT_BOT_RATE_LIMITED", message: "提问过于频繁，请一小时后再试" },
    }),
    "提问过于频繁，请一小时后再试",
  );
});

test("readSupportErrorBody falls back to top-level message", () => {
  assert.equal(readSupportErrorBody({ success: false, message: "未登录" }), "未登录");
  assert.equal(readSupportErrorBody(null), null);
  assert.equal(readSupportErrorBody({}), null);
});
