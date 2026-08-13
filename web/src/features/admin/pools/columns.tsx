import { type ColumnDef } from "@tanstack/react-table";
import type { Pool } from "@/types/api";
import { poolGroupLabel } from "@/lib/labels";

export const poolColumns: ColumnDef<Pool, unknown>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "name", header: "名称" },
  {
    accessorKey: "group_name",
    header: "分组",
    cell: ({ row }) => poolGroupLabel(row.original.group_name),
  },
  {
    accessorKey: "team_id",
    header: "团队",
    cell: ({ row }) => row.original.team_id || "—",
  },
];
