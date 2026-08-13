import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-white/[0.07] bg-ink-900/70 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.8)]", className)}
      {...props}
    />
  );
}
