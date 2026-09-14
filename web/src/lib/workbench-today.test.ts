import assert from "node:assert/strict";
import test from "node:test";
import { formatChangeFoot, formatPercent } from "./workbench-today.ts";

test("change footnote shows signed percent against yesterday", () => {
  assert.equal(formatChangeFoot(0.18), "较昨天 +18%");
  assert.equal(formatChangeFoot(-0.04), "较昨天 -4%");
  assert.equal(formatChangeFoot(0), "较昨天持平");
  assert.equal(formatChangeFoot(null), "较昨天 —");
});

test("percent display rounds to a whole percent", () => {
  assert.equal(formatPercent(0.71), "71%");
  assert.equal(formatPercent(0.142), "14%");
  assert.equal(formatPercent(null), "—");
});
