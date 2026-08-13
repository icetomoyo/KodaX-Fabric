import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { useProjects, useTeams } from "@/lib/query/hooks";
import type { Project, Team } from "@/types/api";
import { CreateProjectDialog } from "./create-project-dialog";
import { CreateTeamDialog } from "./create-team-dialog";

const teamColumns: ColumnDef<Team, unknown>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "name", header: "名称" },
];

export default function OrgPage() {
  const teams = useTeams();
  const projects = useProjects();
  const teamName = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of teams.data ?? []) m.set(t.id, t.name);
    return m;
  }, [teams.data]);

  const projectColumns = useMemo<ColumnDef<Project, unknown>[]>(
    () => [
      { accessorKey: "id", header: "ID" },
      { accessorKey: "name", header: "名称" },
      {
        accessorKey: "team_id",
        header: "团队",
        cell: ({ row }) => teamName.get(row.original.team_id) ?? row.original.team_id,
      },
    ],
    [teamName],
  );

  return (
    <div className="space-y-10">
      <div>
        <PageHeader title="团队" actions={<CreateTeamDialog />} />
        <DataTable
          columns={teamColumns}
          data={teams.data ?? []}
          isLoading={teams.isPending}
          searchPlaceholder="搜索团队…"
        />
      </div>
      <div>
        <PageHeader title="项目" actions={<CreateProjectDialog />} />
        <DataTable
          columns={projectColumns}
          data={projects.data ?? []}
          isLoading={projects.isPending}
          searchPlaceholder="搜索项目…"
        />
      </div>
    </div>
  );
}
