import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Renders an active/disabled pill for any catalog entity status. */
export function StatusBadge({ status }: { status: string }) {
  const on = status === "active";
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent font-normal",
        on
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
      )}
    >
      {on ? "启用" : "停用"}
    </Badge>
  );
}
