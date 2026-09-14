import assert from "node:assert/strict";
import test from "node:test";
import { analysisWindow, formatChangeFoot, formatPercent } from "./workbench-today.ts";

test("change footnote shows signed percent against yesterday", () => {
  assert.equal(formatChangeFoot(0.18), "较昨天 +18%");
  assert.equal(formatChangeFoot(-0.04), "较昨天 -4%");
  assert.equal(formatChangeFoot(0), "较昨天持平");
  assert.equal(formatChangeFoot(null), "较昨天 —");
  assert.equal(formatChangeFoot(0.18, "较前 7 天"), "较前 7 天 +18%");
});

test("analysis window is inclusive quota days ending today", () => {
  const now = new Date("2026-09-14T02:00:00.000Z");
  assert.deepEqual(analysisWindow("7d", now), { from: "2026-09-08", to: "2026-09-14" });
  assert.deepEqual(analysisWindow("30d", now), { from: "2026-08-16", to: "2026-09-14" });
});

test("percent display rounds to a whole percent", () => {
  assert.equal(formatPercent(0.71), "71%");
  assert.equal(formatPercent(0.142), "14%");
  assert.equal(formatPercent(null), "—");
});
