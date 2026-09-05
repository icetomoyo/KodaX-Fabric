export type TeamUsageRow = {
  id: number;
  name: string;
  enterpriseId?: number | null;
  enterpriseName?: string | null;
  departmentId?: number | null;
  departmentName?: string | null;
  isDefault?: boolean;
  todayTotalTokens?: number;
  requestCount?: number;
};

export type MemberUsageRow = {
  employeeId: number;
  name: string;
  todayTotalTokens?: number;
  requestCount?: number;
  teamId: number;
  teamName: string;
  teamIsDefault?: boolean;
  departmentName?: string | null;
  enterpriseName?: string | null;
};

type RankRow = {
  totalTokens: number;
  requestCount: number;
};

function addTokens(row: { todayTotalTokens?: number; requestCount?: number }): RankRow {
  return {
    totalTokens: Number(row.todayTotalTokens) || 0,
    requestCount: Number(row.requestCount) || 0,
  };
}

function merge(left: RankRow, right: RankRow): RankRow {
  return {
    totalTokens: left.totalTokens + right.totalTokens,
    requestCount: left.requestCount + right.requestCount,
  };
}

function top<T extends RankRow>(rows: T[], limit: number): T[] {
  return [...rows]
    .filter((row) => row.totalTokens > 0)
    .sort((left, right) => right.totalTokens - left.totalTokens)
    .slice(0, limit);
}

export function ranksFromTeamUsage(teams: TeamUsageRow[], limit = 10) {
  const used = teams.filter((row) => (Number(row.todayTotalTokens) || 0) > 0);

  const enterprises = new Map<string, {
    enterpriseId?: number;
    enterpriseName: string;
  } & RankRow>();
  const departments = new Map<string, {
    departmentId?: number;
    departmentName: string;
    enterpriseName: string;
  } & RankRow>();

  for (const row of used) {
    const usage = addTokens(row);
    const enterpriseKey = String(row.enterpriseId ?? row.enterpriseName ?? "");
    if (enterpriseKey) {
      const current = enterprises.get(enterpriseKey);
      enterprises.set(enterpriseKey, {
        enterpriseId: row.enterpriseId ?? undefined,
        enterpriseName: row.enterpriseName || "—",
        ...(current ? merge(current, usage) : usage),
      });
    }
    const departmentKey = String(row.departmentId ?? `${row.enterpriseId ?? ""}:${row.departmentName ?? ""}`);
    if (row.departmentId != null || row.departmentName) {
      const current = departments.get(departmentKey);
      departments.set(departmentKey, {
        departmentId: row.departmentId ?? undefined,
        departmentName: row.departmentName || "—",
        enterpriseName: row.enterpriseName || "—",
        ...(current ? merge(current, usage) : usage),
      });
    }
  }

  return {
    topEnterprisesToday: top([...enterprises.values()], limit),
    topDepartmentsToday: top([...departments.values()], limit),
    topTeamsToday: top(
      used
        .filter((row) => !row.isDefault)
        .map((row) => ({
          teamId: row.id,
          teamName: row.name,
          departmentName: row.departmentName || undefined,
          enterpriseName: row.enterpriseName || undefined,
          ...addTokens(row),
        })),
      limit,
    ),
  };
}

export function ranksFromMemberUsage(members: MemberUsageRow[], limit = 10) {
  return top(
    members.map((row) => ({
      employeeId: row.employeeId,
      employeeName: row.name,
      teamName: row.teamName,
      teamIsDefault: row.teamIsDefault,
      departmentName: row.departmentName || undefined,
      enterpriseName: row.enterpriseName || undefined,
      ...addTokens(row),
    })),
    limit,
  );
}
