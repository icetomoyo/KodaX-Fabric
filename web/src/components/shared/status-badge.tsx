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
        on ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-muted-foreground",
      )}
    >
      {on ? "启用" : "停用"}
    </Badge>
  );
}
