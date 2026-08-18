import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useUsage } from "@/lib/query/hooks";
import type { UsageCell } from "@/types/api";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<UsageCell>[] = [
  { accessorKey: "day", header: "日" },
  { accessorKey: "project", header: "Project" },
  { accessorKey: "model", header: "Model" },
  { accessorKey: "calls", header: "调用" },
  { accessorKey: "failed_calls", header: "失败" },
  { accessorKey: "zero_usage_calls", header: "零 Usage" },
  { accessorKey: "input_tokens", header: "input" },
  { accessorKey: "output_tokens", header: "output" },
  { accessorKey: "cost_cny", header: "成本 CNY" },
];

export default function OverviewPage() {
  const [day, setDay] = useState("");
  const [project, setProject] = useState("");
  const usage = useUsage(day || undefined, project || undefined);

  return (
    <div>
      <PageHeader title="用量总览" description="按 Project × Model × 日（Asia/Shanghai）聚合。" />
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void usage.refetch();
        }}
      >
        <div>
          <div className="mb-1 text-xs text-muted-foreground">日</div>
          <Input value={day} onChange={(e) => setDay(e.target.value)} placeholder="YYYY-MM-DD 默认今天" />
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Project</div>
          <Input value={project} onChange={(e) => setProject(e.target.value)} placeholder="全部" />
        </div>
        <Button type="submit" variant="secondary">
          查询
        </Button>
      </form>
      <DataTable columns={columns} data={usage.data?.rows ?? []} isLoading={usage.isPending} />
    </div>
  );
}
