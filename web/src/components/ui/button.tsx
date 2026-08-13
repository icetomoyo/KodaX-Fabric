import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "outline" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-40",
        variant === "primary" && "bg-ember-400 text-ink-950 hover:bg-ember-500",
        variant === "ghost" && "text-sand-100/80 hover:bg-white/5",
        variant === "danger" && "bg-red-500/15 text-red-300 hover:bg-red-500/25",
        variant === "outline" && "border border-white/10 text-sand-50 hover:bg-white/5",
        className,
      )}
      {...props}
    />
  );
}
