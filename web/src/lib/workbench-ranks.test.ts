import assert from "node:assert/strict";
import test from "node:test";
import { ranksFromMemberUsage, ranksFromTeamUsage } from "./workbench-ranks.ts";

test("enterprise and department ranks roll up team usage, default teams stay off the team board", () => {
  const ranks = ranksFromTeamUsage([
    {
      id: 1,
      name: "图数据库研发",
      enterpriseId: 11,
      enterpriseName: "海致星图",
      departmentId: 21,
      departmentName: "研发部",
      isDefault: false,
      todayTotalTokens: 97_099_500,
      requestCount: 1093,
    },
    {
      id: 2,
      name: "默认团队",
      enterpriseId: 12,
      enterpriseName: "海致科技",
      departmentId: 22,
      departmentName: "湖北交付部",
      isDefault: true,
      todayTotalTokens: 45_696_200,
      requestCount: 382,
    },
    {
      id: 3,
      name: "湖北研发组",
      enterpriseId: 12,
      enterpriseName: "海致科技",
      departmentId: 23,
      departmentName: "研发支持中心",
      isDefault: false,
      todayTotalTokens: 26_550_500,
      requestCount: 364,
    },
    {
      id: 4,
      name: "空闲团队",
      enterpriseId: 12,
      enterpriseName: "海致科技",
      departmentId: 23,
      departmentName: "研发支持中心",
      isDefault: false,
      todayTotalTokens: 0,
    },
  ]);

  assert.equal(ranks.topEnterprisesToday.length, 2);
  assert.equal(ranks.topEnterprisesToday[0]?.enterpriseName, "海致星图");
  assert.equal(ranks.topEnterprisesToday[0]?.totalTokens, 97_099_500);
  assert.equal(ranks.topEnterprisesToday[1]?.enterpriseName, "海致科技");
  assert.equal(ranks.topEnterprisesToday[1]?.totalTokens, 45_696_200 + 26_550_500);

  assert.equal(ranks.topDepartmentsToday[0]?.departmentName, "研发部");
  assert.equal(ranks.topDepartmentsToday[1]?.departmentName, "湖北交付部");
  assert.equal(ranks.topDepartmentsToday[1]?.totalTokens, 45_696_200);

  assert.deepEqual(
    ranks.topTeamsToday.map((row) => row.teamName),
    ["图数据库研发", "湖北研发组"],
  );
});

test("employee ranks keep the org path and skip zero usage", () => {
  const rows = ranksFromMemberUsage([
    {
      employeeId: 1,
      name: "张三",
      todayTotalTokens: 80,
      teamId: 8,
      teamName: "默认团队",
      teamIsDefault: true,
      departmentName: "湖北交付部",
      enterpriseName: "海致科技",
    },
    {
      employeeId: 2,
      name: "李四",
      todayTotalTokens: 0,
      teamId: 9,
      teamName: "湖北研发组",
      teamIsDefault: false,
      departmentName: "研发支持中心",
      enterpriseName: "海致科技",
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.employeeName, "张三");
  assert.equal(rows[0]?.teamIsDefault, true);
  assert.equal(rows[0]?.departmentName, "湖北交付部");
});
