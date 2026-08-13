import { type ColumnDef } from "@tanstack/react-table";
import type { Pool } from "@/types/api";

export const poolColumns: ColumnDef<Pool, unknown>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "name", header: "名称" },
  { accessorKey: "group_name", header: "分组" },
];
