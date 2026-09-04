import assert from "node:assert/strict";
import test from "node:test";
import { formatTokenCompact } from "./tokens.ts";

test("compact 亿 values keep two decimal places so 7.80 亿 is not shown as 7 亿", () => {
  assert.equal(formatTokenCompact(780_000_000), "7.80 亿");
  assert.equal(formatTokenCompact(787_999_000), "7.88 亿");
  assert.equal(formatTokenCompact(310_000_000), "3.10 亿");
  assert.equal(formatTokenCompact(250_000_000), "2.50 亿");
  assert.equal(formatTokenCompact(220_000_000), "2.20 亿");
});

test("compact 万 values keep two decimal places", () => {
  assert.equal(formatTokenCompact(6_359_000), "635.90 万");
  assert.equal(formatTokenCompact(1_640_000), "164.00 万");
});
