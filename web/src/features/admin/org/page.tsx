import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { FolderOpen } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects, useTeams } from "@/lib/query/hooks";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/api";
import { CreateProjectDialog } from "./create-project-dialog";
import { CreateTeamDialog } from "./create-team-dialog";

const projectColumns: ColumnDef<Project, unknown>[] = [
  {
    accessorKey: "id",
    header: "ID",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">{row.original.id}</span>
    ),
  },
  { accessorKey: "name", header: "名称" },
];

export default function OrgPage() {
  const teams = useTeams();
  const projects = useProjects();
  const [pickedId, setPickedId] = useState<number | null>(null);
  const list = teams.data ?? [];
  const selectedId =
    pickedId != null && list.some((t) => t.id === pickedId) ? pickedId : (list[0]?.id ?? null);
  const selected = list.find((t) => t.id === selectedId) ?? null;
  const filtered = useMemo(
    () => (projects.data ?? []).filter((p) => p.team_id === selectedId),
    [projects.data, selectedId],
  );
  const projectCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of projects.data ?? []) m.set(p.team_id, (m.get(p.team_id) ?? 0) + 1);
    return m;
  }, [projects.data]);

  return (
    <div>
      <PageHeader title="团队项目" description="点左侧团队，右侧只看这个队的项目。" />
      <div className="flex min-h-[28rem] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card md:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-border bg-muted/30 md:w-60 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="flex items-baseline gap-1.5 text-xs font-medium tracking-wide text-muted-foreground">
              团队
              {list.length > 0 && (
                <span className="font-mono text-[11px] font-normal opacity-70">{list.length}</span>
              )}
            </span>
            <CreateTeamDialog onCreated={(t) => setPickedId(t.id)} />
          </div>
          <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
            {teams.isPending ? (
              <div className="space-y-2 px-1 pt-1">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : list.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">还没有团队。</p>
            ) : (
              list.map((t) => {
                const active = selectedId === t.id;
                const count = projectCount.get(t.id) ?? 0;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setPickedId(t.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "bg-accent font-medium text-accent-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{t.name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[11px] leading-none",
                        active
                          ? "bg-background/70 text-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })
            )}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 p-5">
          {!selected ? (
            <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 text-center">
              <FolderOpen className="h-8 w-8 text-muted-foreground/50" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">先在左侧建一个团队。</p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">{selected.name}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {filtered.length > 0 ? `${filtered.length} 个项目` : "这个团队还没有项目"}
                  </p>
                </div>
                <CreateProjectDialog teamId={selected.id} />
              </div>
              <DataTable
                columns={projectColumns}
                data={filtered}
                isLoading={projects.isPending}
                searchPlaceholder="搜索项目…"
                emptyText="这个团队还没有项目。"
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
