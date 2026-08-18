import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRequests } from "@/lib/query/hooks";
import type { RequestRow } from "@/types/api";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<RequestRow>[] = [
  { accessorKey: "created_at", header: "时间" },
  { accessorKey: "project", header: "Project" },
  { accessorKey: "model", header: "Model" },
  { accessorKey: "status", header: "状态" },
  { accessorKey: "latency_ms", header: "延迟 ms" },
  { accessorKey: "input_tokens", header: "input" },
  { accessorKey: "output_tokens", header: "output" },
  { accessorKey: "cached_tokens", header: "cached" },
  { accessorKey: "cost_cny", header: "成本 CNY" },
  { accessorKey: "run_id", header: "run_id" },
  { accessorKey: "task_type", header: "task_type" },
];

export default function RequestsPage() {
  const [project, setProject] = useState("");
  const requests = useRequests(project || undefined);

  return (
    <div>
      <PageHeader title="请求流水" description="账本粒度。每次调用一行，不可改。延迟含上游等待。" />
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void requests.refetch();
        }}
      >
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Project</div>
          <Input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="默认 demo"
          />
        </div>
        <Button type="submit" variant="secondary">
          查询
        </Button>
      </form>
      <DataTable
        columns={columns}
        data={[...(requests.data?.requests ?? [])].reverse()}
        isLoading={requests.isPending}
      />
    </div>
  );
}
