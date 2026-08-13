import { type ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import type { ProviderKey } from "@/types/api";

export function providerColumns(
  onToggle: (k: ProviderKey) => void,
  busy: boolean,
): ColumnDef<ProviderKey, unknown>[] {
  return [
    { accessorKey: "id", header: "ID" },
    { accessorKey: "provider_code", header: "厂商" },
    {
      accessorKey: "team_id",
      header: "团队",
      cell: ({ row }) => row.original.team_id || "—",
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
        const k = row.original;
        return (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onToggle(k)}>
            {k.status === "active" ? "停用" : "启用"}
          </Button>
        );
      },
    },
  ];
}
