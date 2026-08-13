import { type ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import type { Operator } from "@/types/api";

export function userColumns(
  onToggle: (u: Operator) => void,
  busy: boolean,
): ColumnDef<Operator, unknown>[] {
  return [
    {
      accessorKey: "name",
      header: "姓名",
      cell: ({ row }) => row.original.name || "—",
    },
    {
      accessorKey: "phone",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          手机
          <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
        </Button>
      ),
    },
    {
      accessorKey: "role",
      header: "角色",
      cell: ({ row }) => (row.original.role === "admin" ? "管理员" : "开发者"),
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const u = row.original;
        return (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onToggle(u)}>
            {u.status === "active" ? "停用" : "启用"}
          </Button>
        );
      },
    },
  ];
}
