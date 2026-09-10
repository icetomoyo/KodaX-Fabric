import assert from "node:assert/strict";
import test from "node:test";
import {
  departmentAndDescendantIds,
  descendantDepartmentIds,
  firstLevelDepartmentId,
} from "../src/lib/department-tree.js";

const nodes = [
  { id: 8, parentId: null },
  { id: 9, parentId: null },
  { id: 18, parentId: 8 },
  { id: 26, parentId: 9 },
  { id: 41, parentId: 18 },
];

test("first-level department is the ancestor hanging on the enterprise", () => {
  assert.equal(firstLevelDepartmentId(8, nodes), 8);
  assert.equal(firstLevelDepartmentId(18, nodes), 8);
  assert.equal(firstLevelDepartmentId(41, nodes), 8);
  assert.equal(firstLevelDepartmentId(26, nodes), 9);
  assert.equal(firstLevelDepartmentId(99, nodes), 99);
});

test("descendants include every nested child and not siblings", () => {
  assert.deepEqual(descendantDepartmentIds(8, nodes).sort((a, b) => a - b), [18, 41]);
  assert.deepEqual(departmentAndDescendantIds(8, nodes).sort((a, b) => a - b), [8, 18, 41]);
  assert.deepEqual(descendantDepartmentIds(9, nodes), [26]);
  assert.deepEqual(descendantDepartmentIds(41, nodes), []);
});
