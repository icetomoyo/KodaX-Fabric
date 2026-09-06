import assert from "node:assert/strict";
import test from "node:test";
import { TABLE_PAGE_SIZE, sliceTablePage } from "./table-page.ts";

test("table page size is 10", () => {
  assert.equal(TABLE_PAGE_SIZE, 10);
});

test("sliceTablePage keeps 10 rows per page", () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1);
  assert.deepEqual(sliceTablePage(items, 1), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(sliceTablePage(items, 2), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(sliceTablePage(items, 3), [21, 22, 23]);
});
