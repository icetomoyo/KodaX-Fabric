import { type ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import type { Channel } from "@/types/api";

export function channelColumns(
  onToggle: (c: Channel) => void,
  busy: boolean,
): ColumnDef<Channel, unknown>[] {
  return [
    { accessorKey: "id", header: "ID" },
    { accessorKey: "pool_id", header: "池" },
    { accessorKey: "provider_key_id", header: "Key" },
    { accessorKey: "protocol", header: "协议" },
    {
      accessorKey: "base_url",
      header: "上游",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.base_url}</span>,
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
        const c = row.original;
        return (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onToggle(c)}>
            {c.status === "active" ? "停用" : "启用"}
          </Button>
        );
      },
    },
  ];
}
