import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  departments,
  employees,
  enterprises,
  teamMembers,
  teams,
} from "../../db/schema/index.js";
import { DEFAULT_DEPARTMENT_NAME } from "../enterprise.js";
import { departmentPathLabel } from "../department-tree.js";
import { employeeDepartmentConflictMessage } from "../org.js";
import { writeOpsAudit } from "../ops-audit.js";
import type { SessionRole } from "../jwt.js";
import { nameMatchScore, normalizeOrgName } from "./invite-contacts.js";

export type JoinDirectoryDepartment = {
  id: number;
  name: string;
  parentId: number | null;
  enterpriseId: number;
  enterpriseName: string;
  isDefault: boolean;
  teamId: number | null;
};

export type JoinDirectory = {
  departments: JoinDirectoryDepartment[];
};

export type JoinDepartmentQuery = {
  departmentName?: string;
  enterpriseName?: string;
  employeeEnterpriseId?: number | null;
};

export type JoinDepartmentMatch = {
  departmentId: number;
  departmentName: string;
  enterpriseId: number;
  enterpriseName: string;
  teamId: number;
  path: string;
};

export type JoinDepartmentLookupStatus = "need_name" | "not_found" | "ambiguous" | "found";

export type JoinDepartmentLookup = {
  status: JoinDepartmentLookupStatus;
  message: string;
  match: JoinDepartmentMatch | null;
  matches: JoinDepartmentMatch[];
};

export type JoinEmployeeSnapshot = {
  id: number;
  role: SessionRole;
  status: string;
  enterpriseId: number | null;
};

export type JoinPlan =
  | { action: "join"; match: JoinDepartmentMatch }
  | { action: "already"; match: JoinDepartmentMatch; message: string }
  | { action: "forbidden"; message: string }
  | { action: "other_enterprise"; message: string };

const MAX_AMBIGUOUS = 8;

export function departmentQueryScore(query: string, option: { name: string; path: string }): number {
  const needle = normalizeOrgName(query);
  if (!needle) return 0;
  const name = normalizeOrgName(option.name);
  const path = normalizeOrgName(option.path);
  if (name === needle || path === needle) return 5;
  if (path.endsWith(needle) && needle.length >= Math.min(4, name.length)) return 4;
  return Math.max(nameMatchScore(query, option.name), nameMatchScore(query, option.path));
}

function scoredMatches(
  directory: JoinDirectory,
  query: JoinDepartmentQuery,
): JoinDepartmentMatch[] {
  const departmentName = query.departmentName?.trim() ?? "";
  if (!departmentName) return [];
  const enterpriseName = query.enterpriseName?.trim() ?? "";
  const rows = directory.departments.filter((row) => {
    if (row.teamId == null) return false;
    if (query.employeeEnterpriseId != null && row.enterpriseId !== query.employeeEnterpriseId) {
      return false;
    }
    if (row.isDefault && normalizeOrgName(departmentName) !== normalizeOrgName(DEFAULT_DEPARTMENT_NAME)) {
      return false;
    }
    if (enterpriseName && nameMatchScore(enterpriseName, row.enterpriseName) < 2) return false;
    return true;
  });
  const options: Array<JoinDepartmentMatch & { score: number }> = [];
  for (const row of rows) {
    const path = departmentPathLabel({
      departmentId: row.id,
      departments: directory.departments,
      enterpriseName: row.enterpriseName,
    });
    const score = departmentQueryScore(departmentName, { name: row.name, path });
    if (score < 2 || row.teamId == null) continue;
    options.push({
      departmentId: row.id,
      departmentName: row.name,
      enterpriseId: row.enterpriseId,
      enterpriseName: row.enterpriseName,
      teamId: row.teamId,
      path,
      score,
    });
  }
  options.sort(
    (left, right) =>
      right.score - left.score ||
      left.path.localeCompare(right.path, "zh-CN"),
  );
  const top = options[0]?.score ?? 0;
  return options.filter((row) => row.score === top);
}

export function selectDepartmentForJoin(
  directory: JoinDirectory,
  query: JoinDepartmentQuery,
): JoinDepartmentLookup {
  const departmentName = query.departmentName?.trim() ?? "";
  if (!departmentName) {
    return {
      status: "need_name",
      message: "还不知道加入哪个部门。请用户说出部门名；如果有多家企业同名部门，再补企业名。",
      match: null,
      matches: [],
    };
  }
  const matches = scoredMatches(directory, query);
  if (matches.length === 0) {
    const enterpriseHint = query.enterpriseName?.trim()
      ? `企业「${query.enterpriseName.trim()}」下`
      : query.employeeEnterpriseId != null
        ? "你所在的企业下"
        : "";
    return {
      status: "not_found",
      message: `${enterpriseHint}没有找到名为「${departmentName}」的部门。请用户确认部门全称后再试。不要编造部门。`,
      match: null,
      matches: [],
    };
  }
  if (matches.length > 1) {
    const names = [...new Set(matches.slice(0, MAX_AMBIGUOUS).map((item) => item.path))];
    return {
      status: "ambiguous",
      message: `找到多个接近的部门：${names.join("、")}。请用户确认是哪一个（可补企业名或更完整的部门路径）。`,
      match: null,
      matches,
    };
  }
  const match = matches[0]!;
  return {
    status: "found",
    message: `将加入「${match.path}」。`,
    match,
    matches: [match],
  };
}

export function planDepartmentJoin(input: {
  employee: JoinEmployeeSnapshot;
  membershipDepartmentIds: readonly number[];
  lookup: JoinDepartmentLookup;
}): JoinPlan | { action: "lookup"; lookup: JoinDepartmentLookup } {
  if (input.lookup.status !== "found" || !input.lookup.match) {
    return { action: "lookup", lookup: input.lookup };
  }
  const match = input.lookup.match;
  if (input.employee.role === "admin" || input.employee.role === "org_admin") {
    return {
      action: "forbidden",
      message: "当前账号不能通过 Token Bot 加入部门。",
    };
  }
  if (input.employee.status !== "active") {
    return {
      action: "forbidden",
      message: "当前账号未启用，不能加入部门。",
    };
  }
  if (
    input.employee.enterpriseId != null &&
    input.employee.enterpriseId !== match.enterpriseId
  ) {
    return {
      action: "other_enterprise",
      message: `你已经在其他企业，不能加入「${match.path}」。`,
    };
  }
  if (input.membershipDepartmentIds.includes(match.departmentId)) {
    return {
      action: "already",
      match,
      message: `你已经在「${match.path}」。`,
    };
  }
  return { action: "join", match };
}

export function formatDepartmentJoinResult(input: {
  plan: Exclude<ReturnType<typeof planDepartmentJoin>, { action: "lookup" }>;
  joined: boolean;
}): string {
  if (input.plan.action === "join" && input.joined) {
    return `已把你加入「${input.plan.match.path}」。请刷新页面，然后就可以创建 API Key。`;
  }
  if (input.plan.action === "join") {
    return `没能加入「${input.plan.match.path}」，请稍后再试或联系部门管理员。`;
  }
  return input.plan.message;
}

export async function loadJoinDirectory(): Promise<JoinDirectory> {
  const rows = await db
    .select({
      id: departments.id,
      name: departments.name,
      parentId: departments.parentId,
      enterpriseId: departments.enterpriseId,
      enterpriseName: enterprises.name,
      isDefault: departments.isDefault,
      teamId: teams.id,
    })
    .from(departments)
    .innerJoin(enterprises, eq(departments.enterpriseId, enterprises.id))
    .leftJoin(
      teams,
      and(eq(teams.departmentId, departments.id), eq(teams.isDefault, true), eq(teams.status, "active")),
    )
    .where(and(eq(departments.status, "active"), eq(enterprises.status, "active")));
  return {
    departments: rows.map((row) => ({
      ...row,
      teamId: row.teamId ?? null,
    })),
  };
}

export async function joinDepartmentForEmployee(input: {
  employeeId: number;
  departmentName?: string;
  enterpriseName?: string;
}): Promise<string> {
  const [employee] = await db
    .select({
      id: employees.id,
      role: employees.role,
      status: employees.status,
      enterpriseId: employees.enterpriseId,
    })
    .from(employees)
    .where(eq(employees.id, input.employeeId))
    .limit(1);
  if (!employee) return "找不到当前账号，不能加入部门。";

  const memberships = await db
    .select({
      teamId: teamMembers.teamId,
      departmentId: teams.departmentId,
      departmentName: departments.name,
      isDefault: teams.isDefault,
      status: teams.status,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(eq(teamMembers.employeeId, employee.id));

  const directory = await loadJoinDirectory();
  const lookup = selectDepartmentForJoin(directory, {
    departmentName: input.departmentName,
    enterpriseName: input.enterpriseName,
    employeeEnterpriseId: employee.enterpriseId,
  });
  const plan = planDepartmentJoin({
    employee,
    membershipDepartmentIds: memberships.map((row) => row.departmentId),
    lookup,
  });
  if (plan.action === "lookup") return plan.lookup.message;
  if (plan.action !== "join") return formatDepartmentJoinResult({ plan, joined: false });

  const conflict = employeeDepartmentConflictMessage(memberships, {
    teamId: plan.match.teamId,
    departmentId: plan.match.departmentId,
  });
  if (conflict) {
    return `你已经在「${plan.match.path}」。`;
  }

  if (employee.enterpriseId == null) {
    await db
      .update(employees)
      .set({ enterpriseId: plan.match.enterpriseId, updatedAt: new Date() })
      .where(eq(employees.id, employee.id));
  }

  try {
    await db.insert(teamMembers).values({
      teamId: plan.match.teamId,
      employeeId: employee.id,
      role: "member",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("team_members_team_employee_uidx") || message.includes("unique")) {
      return `你已经在「${plan.match.path}」。`;
    }
    throw error;
  }

  await writeOpsAudit({
    actorEmployeeId: employee.id,
    action: "department.self_join",
    targetType: "department",
    targetId: String(plan.match.departmentId),
    detail: {
      employeeId: employee.id,
      teamId: plan.match.teamId,
      path: plan.match.path,
      source: "token_bot",
    },
  });

  return formatDepartmentJoinResult({ plan, joined: true });
}
