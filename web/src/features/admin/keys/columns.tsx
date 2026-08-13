import { type ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { CopyText } from "@/components/shared/copy-text";
import { StatusBadge } from "@/components/shared/status-badge";
import type { VirtualKey } from "@/types/api";

export function vkColumns(
  onToggle: (k: VirtualKey) => void,
  busy: boolean,
): ColumnDef<VirtualKey, unknown>[] {
  return [
    { accessorKey: "id", header: "ID" },
    {
      accessorKey: "key_masked",
      header: "掩码",
      cell: ({ row }) => (
        <CopyText value={row.original.key_masked} className="font-mono text-xs text-foreground" />
      ),
    },
    { accessorKey: "pool_id", header: "池" },
    {
      accessorKey: "owner_id",
      header: "持有人",
      cell: ({ row }) => row.original.owner_id || "—",
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
