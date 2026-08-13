import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { useRouteDecisions } from "@/lib/query/hooks";
import { poolGroupLabel } from "@/lib/labels";
import type { RouteDecision } from "@/types/api";

const columns: ColumnDef<RouteDecision, unknown>[] = [
  { accessorKey: "request_id", header: "请求" },
  { accessorKey: "channel_id", header: "渠" },
  { accessorKey: "reason", header: "原因" },
  {
    accessorKey: "fallback",
    header: "换路",
    cell: ({ row }) => (row.original.fallback ? "是" : "—"),
  },
  {
    accessorKey: "pool_group",
    header: "分组",
    cell: ({ row }) => poolGroupLabel(row.original.pool_group),
  },
  {
    accessorKey: "created_at",
    header: "时间",
    cell: ({ row }) =>
      row.original.created_at ? new Date(row.original.created_at).toLocaleString() : "—",
  },
];

export default function AuditPage() {
  const rows = useRouteDecisions();
  return (
    <div>
      <PageHeader title="路由审计" description="最近选路记录，对应响应头 X-Fabric-*。" />
      <DataTable
        columns={columns}
        data={rows.data ?? []}
        isLoading={rows.isPending}
        searchPlaceholder="搜索请求 / 原因…"
      />
    </div>
  );
}
