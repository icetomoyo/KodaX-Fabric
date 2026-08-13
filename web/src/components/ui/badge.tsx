import { cn } from "@/lib/utils";

export function Badge({ status, className }: { status: string; className?: string }) {
  const on = status === "active" || status === "approved";
  const warn = status === "pending";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide",
        on && "bg-emerald-500/15 text-emerald-300",
        warn && "bg-amber-500/15 text-amber-200",
        !on && !warn && "bg-white/10 text-white/50",
        className,
      )}
    >
      {status || "—"}
    </span>
  );
}
