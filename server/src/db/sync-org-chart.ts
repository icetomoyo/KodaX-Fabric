import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import "../config.js";
import { db } from "./client.js";
import { departments, employees, enterprises, teamMembers, teams } from "./schema/index.js";
import {
  applyOrgChartSync,
  planOrgChartSync,
  type OrgChartFile,
} from "../lib/org-chart-sync.js";

function chartPathFromArgs(argv: string[]): { dryRun: boolean; path: string } {
  const dryRun = argv.includes("--dry-run");
  const positional = argv.filter((item) => item !== "--dry-run");
  const fallback = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/haizhi-org.json");
  return { dryRun, path: positional[0] ?? process.env.ORG_CHART_PATH ?? fallback };
}

async function loadState() {
  const [enterpriseRows, departmentRows, employeeRows, membershipRows] = await Promise.all([
    db.select({ id: enterprises.id, name: enterprises.name }).from(enterprises),
    db
      .select({
        id: departments.id,
        enterpriseId: departments.enterpriseId,
        parentId: departments.parentId,
        name: departments.name,
        isDefault: departments.isDefault,
      })
      .from(departments),
    db
      .select({
        id: employees.id,
        name: employees.name,
        role: employees.role,
        enterpriseId: employees.enterpriseId,
      })
      .from(employees),
    db
      .select({
        employeeId: teamMembers.employeeId,
        departmentId: teams.departmentId,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id)),
  ]);
  const departmentIds = new Map<number, number[]>();
  for (const row of membershipRows) {
    const list = departmentIds.get(row.employeeId) ?? [];
    list.push(row.departmentId);
    departmentIds.set(row.employeeId, list);
  }
  return {
    enterprises: enterpriseRows,
    departments: departmentRows,
    employees: employeeRows.map((row) => ({
      ...row,
      departmentIds: departmentIds.get(row.id) ?? [],
    })),
  };
}

async function main() {
  const { dryRun, path } = chartPathFromArgs(process.argv.slice(2));
  const chart = JSON.parse(readFileSync(path, "utf8")) as OrgChartFile;
  const state = await loadState();
  const plan = planOrgChartSync({ chart, ...state });
  console.log(
    JSON.stringify(
      {
        chart: path,
        dryRun,
        createDepartments: plan.createDepartments.length,
        renameDepartments: plan.renameDepartments.length,
        enterpriseMoves: plan.enterpriseMoves.length,
        memberships: plan.memberships.length,
        unmatchedEmployees: plan.unmatchedEmployees.length,
        sampleCreates: plan.createDepartments.slice(0, 8),
        sampleRenames: plan.renameDepartments.slice(0, 8),
        sampleMoves: plan.enterpriseMoves.slice(0, 8),
        sampleMemberships: plan.memberships.slice(0, 8).map((row) => ({
          name: row.name,
          paths: row.desiredPaths.map((path) => path.join("/")),
        })),
      },
      null,
      2,
    ),
  );
  if (dryRun) return;
  const result = await applyOrgChartSync(plan);
  console.log(JSON.stringify({ applied: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
