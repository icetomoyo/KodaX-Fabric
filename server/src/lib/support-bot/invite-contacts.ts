import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { departments, employees, enterprises, teamMembers, teams } from "../../db/schema/index.js";

export type InviteRole = "team_admin" | "dept_admin" | "org_admin";

export type InviteContact = {
  name: string;
  role: InviteRole;
};

export type InviteMatch = {
  enterpriseName: string;
  departmentName: string | null;
  teamName: string | null;
  contacts: InviteContact[];
};

export type InviteLookupStatus = "need_names" | "not_found" | "ambiguous" | "found";

export type InviteLookupResult = {
  status: InviteLookupStatus;
  message: string;
  matches: InviteMatch[];
};

export type InviteDirectoryEnterprise = {
  id: number;
  name: string;
};

export type InviteDirectoryTeam = {
  id: number;
  name: string;
  enterpriseId: number;
  departmentId: number;
  departmentName: string;
  enterpriseName: string;
};

export type InviteDirectoryAdmin = {
  name: string;
  role: InviteRole;
  enterpriseId: number;
  departmentId: number | null;
  teamId: number | null;
};

export type InviteDirectory = {
  enterprises: InviteDirectoryEnterprise[];
  teams: InviteDirectoryTeam[];
  admins: InviteDirectoryAdmin[];
};

export type InviteLookupQuery = {
  enterpriseName?: string;
  teamName?: string;
  departmentName?: string;
};

const ROLE_LABEL: Record<InviteRole, string> = {
  team_admin: "团队管理员",
  dept_admin: "部门管理员",
  org_admin: "企业管理员",
};

const MAX_AMBIGUOUS = 8;

export function normalizeOrgName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s·•._\-—–（）()]/g, "");
}

export function nameMatchScore(query: string, name: string): number {
  const needle = normalizeOrgName(query);
  const haystack = normalizeOrgName(name);
  if (!needle || !haystack) return 0;
  if (haystack === needle) return 3;
  if (haystack.includes(needle) || needle.includes(haystack)) return 2;
  return 0;
}

function uniqueContacts(contacts: InviteContact[]): InviteContact[] {
  const seen = new Set<string>();
  const result: InviteContact[] = [];
  for (const contact of contacts) {
    const key = `${contact.role}:${contact.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(contact);
  }
  return result;
}

function contactsFor(
  directory: InviteDirectory,
  match: { enterpriseId: number; departmentId?: number | null; teamId?: number | null },
): InviteContact[] {
  const teamAdmins = match.teamId
    ? directory.admins.filter(
        (admin) => admin.role === "team_admin" && admin.teamId === match.teamId,
      )
    : [];
  const deptAdmins = match.departmentId
    ? directory.admins.filter(
        (admin) =>
          admin.role === "dept_admin" &&
          admin.enterpriseId === match.enterpriseId &&
          admin.departmentId === match.departmentId,
      )
    : [];
  const orgAdmins = directory.admins.filter(
    (admin) => admin.role === "org_admin" && admin.enterpriseId === match.enterpriseId,
  );

  if (match.teamId) {
    if (teamAdmins.length > 0) return uniqueContacts(teamAdmins);
    if (deptAdmins.length > 0) return uniqueContacts([...deptAdmins, ...orgAdmins]);
    return uniqueContacts(orgAdmins);
  }
  if (match.departmentId) {
    if (deptAdmins.length > 0) return uniqueContacts([...deptAdmins, ...orgAdmins]);
    return uniqueContacts(orgAdmins);
  }
  return uniqueContacts(orgAdmins);
}

export function formatInviteLookup(result: InviteLookupResult): string {
  return result.message;
}

export function selectInviteContacts(
  directory: InviteDirectory,
  query: InviteLookupQuery,
): InviteLookupResult {
  const enterpriseName = query.enterpriseName?.trim() ?? "";
  const teamName = query.teamName?.trim() ?? "";
  const departmentName = query.departmentName?.trim() ?? "";

  if (!enterpriseName) {
    return {
      status: "need_names",
      message:
        "还不知道该找谁。请用户先说出自己所属的企业名，以及团队名或部门名。没有这些名字就不要编造具体人名。",
      matches: [],
    };
  }

  const enterpriseHits = directory.enterprises
    .map((item) => ({ item, score: nameMatchScore(enterpriseName, item.name) }))
    .filter((row) => row.score >= 2)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name));

  if (enterpriseHits.length === 0) {
    return {
      status: "not_found",
      message: `没有找到名为「${enterpriseName}」的企业。请用户确认企业全称后再问。不要编造管理员姓名。`,
      matches: [],
    };
  }

  const topEnterpriseScore = enterpriseHits[0]?.score ?? 0;
  const enterprises = enterpriseHits.filter((row) => row.score === topEnterpriseScore).map((row) => row.item);
  if (enterprises.length > 1 && !teamName && !departmentName) {
    const names = enterprises.slice(0, MAX_AMBIGUOUS).map((item) => item.name);
    return {
      status: "ambiguous",
      message: `找到多家接近的企业：${names.join("、")}。请用户确认是哪一家，并补充团队名或部门名。`,
      matches: enterprises.map((item) => ({
        enterpriseName: item.name,
        departmentName: null,
        teamName: null,
        contacts: [],
      })),
    };
  }

  const enterprise = enterprises[0];
  if (!enterprise) {
    return {
      status: "not_found",
      message: `没有找到名为「${enterpriseName}」的企业。请用户确认企业全称后再问。不要编造管理员姓名。`,
      matches: [],
    };
  }

  const teamsInEnterprise = directory.teams.filter((team) => team.enterpriseId === enterprise.id);

  if (teamName) {
    const teamHits = teamsInEnterprise
      .map((item) => ({ item, score: nameMatchScore(teamName, item.name) }))
      .filter((row) => row.score >= 2)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name));
    if (teamHits.length === 0) {
      return {
        status: "not_found",
        message: `企业「${enterprise.name}」下没有找到名为「${teamName}」的团队。请用户确认团队名，或改说部门名。不要编造管理员姓名。`,
        matches: [],
      };
    }
    const topScore = teamHits[0]?.score ?? 0;
    const teams = teamHits.filter((row) => row.score === topScore).map((row) => row.item);
    if (teams.length > 1) {
      return {
        status: "ambiguous",
        message: `企业「${enterprise.name}」下有多个接近的团队：${teams.map((item) => item.name).join("、")}。请用户确认是哪一个。`,
        matches: teams.map((item) => ({
          enterpriseName: enterprise.name,
          departmentName: item.departmentName,
          teamName: item.name,
          contacts: [],
        })),
      };
    }
    const team = teams[0]!;
    const contacts = contactsFor(directory, {
      enterpriseId: enterprise.id,
      departmentId: team.departmentId,
      teamId: team.id,
    });
    return foundResult({
      enterpriseName: enterprise.name,
      departmentName: team.departmentName,
      teamName: team.name,
      contacts,
    });
  }

  if (departmentName) {
    const deptHits = teamsInEnterprise
      .map((item) => ({ item, score: nameMatchScore(departmentName, item.departmentName) }))
      .filter((row) => row.score >= 2);
    const departments = [
      ...new Map(
        deptHits.map((row) => [
          row.item.departmentId,
          { id: row.item.departmentId, name: row.item.departmentName, score: row.score },
        ]),
      ).values(),
    ].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
    if (departments.length === 0) {
      return {
        status: "not_found",
        message: `企业「${enterprise.name}」下没有找到名为「${departmentName}」的部门。请用户确认部门名或改说团队名。不要编造管理员姓名。`,
        matches: [],
      };
    }
    if (departments.length > 1 && departments[0]?.score === departments[1]?.score) {
      return {
        status: "ambiguous",
        message: `企业「${enterprise.name}」下有多个接近的部门：${departments.map((item) => item.name).join("、")}。请用户确认是哪一个。`,
        matches: [],
      };
    }
    const department = departments[0]!;
    const contacts = contactsFor(directory, {
      enterpriseId: enterprise.id,
      departmentId: department.id,
    });
    return foundResult({
      enterpriseName: enterprise.name,
      departmentName: department.name,
      teamName: null,
      contacts,
    });
  }

  const contacts = contactsFor(directory, { enterpriseId: enterprise.id });
  const namedTeams = teamsInEnterprise.filter((team) => !/默认/.test(team.name)).slice(0, 8);
  const teamHint =
    namedTeams.length > 0
      ? `若要进具体团队，请再提供团队名（例如：${namedTeams.map((item) => item.name).join("、")}）。`
      : "若要进具体团队，请再提供团队名或部门名。";
  return foundResult(
    {
      enterpriseName: enterprise.name,
      departmentName: null,
      teamName: null,
      contacts,
    },
    teamHint,
  );
}

function foundResult(match: InviteMatch, extra?: string): InviteLookupResult {
  const lines = [`企业「${match.enterpriseName}」`];
  if (match.departmentName) lines[0] += ` / 部门「${match.departmentName}」`;
  if (match.teamName) lines[0] += ` / 团队「${match.teamName}」`;
  if (match.contacts.length === 0) {
    lines.push("没有查到可邀请的管理员姓名。请用户向所在团队的团队管理员、部门管理员或企业管理员求助，不要编造人名。");
  } else {
    lines.push("可邀请你进团队的管理员：");
    for (const contact of match.contacts) {
      lines.push(`- ${contact.name}（${ROLE_LABEL[contact.role]}）`);
    }
    lines.push("用户把自己的注册手机号发给对方即可。不要向用户展示或索要管理员手机号。");
  }
  if (extra) lines.push(extra);
  return {
    status: "found",
    message: lines.join("\n"),
    matches: [match],
  };
}

export async function loadInviteDirectory(): Promise<InviteDirectory> {
  const enterpriseRows = await db
    .select({
      id: enterprises.id,
      name: enterprises.name,
    })
    .from(enterprises)
    .where(eq(enterprises.status, "active"));

  const teamRows = await db
    .select({
      id: teams.id,
      name: teams.name,
      enterpriseId: teams.enterpriseId,
      departmentId: teams.departmentId,
      departmentName: departments.name,
      enterpriseName: enterprises.name,
    })
    .from(teams)
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .innerJoin(enterprises, eq(teams.enterpriseId, enterprises.id))
    .where(eq(teams.status, "active"));

  const orgAdminRows = await db
    .select({
      name: employees.name,
      enterpriseId: employees.enterpriseId,
    })
    .from(employees)
    .where(and(eq(employees.role, "org_admin"), eq(employees.status, "active")));

  const deptAdminRows = await db
    .select({
      name: employees.name,
      enterpriseId: employees.enterpriseId,
      departmentId: teams.departmentId,
    })
    .from(employees)
    .innerJoin(teamMembers, eq(teamMembers.employeeId, employees.id))
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(and(eq(employees.role, "dept_admin"), eq(employees.status, "active")));

  const teamAdminRows = await db
    .select({
      name: employees.name,
      enterpriseId: teams.enterpriseId,
      departmentId: teams.departmentId,
      teamId: teams.id,
    })
    .from(teamMembers)
    .innerJoin(employees, eq(teamMembers.employeeId, employees.id))
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(and(eq(teamMembers.role, "team_admin"), eq(employees.status, "active")));

  const admins: InviteDirectoryAdmin[] = [];
  for (const row of orgAdminRows) {
    if (row.enterpriseId == null) continue;
    admins.push({
      name: row.name,
      role: "org_admin",
      enterpriseId: row.enterpriseId,
      departmentId: null,
      teamId: null,
    });
  }
  for (const row of deptAdminRows) {
    if (row.enterpriseId == null) continue;
    admins.push({
      name: row.name,
      role: "dept_admin",
      enterpriseId: row.enterpriseId,
      departmentId: row.departmentId,
      teamId: null,
    });
  }
  for (const row of teamAdminRows) {
    admins.push({
      name: row.name,
      role: "team_admin",
      enterpriseId: row.enterpriseId,
      departmentId: row.departmentId,
      teamId: row.teamId,
    });
  }

  return {
    enterprises: enterpriseRows,
    teams: teamRows,
    admins,
  };
}

export async function lookupInviteContacts(query: InviteLookupQuery): Promise<string> {
  if (!query.enterpriseName?.trim()) {
    return selectInviteContacts({ enterprises: [], teams: [], admins: [] }, query).message;
  }
  const directory = await loadInviteDirectory();
  return formatInviteLookup(selectInviteContacts(directory, query));
}
