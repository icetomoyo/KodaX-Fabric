import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One-click copy for secrets / masked keys. Shows a transient check on success.
 * Used for the one-time VK plaintext reveal and any copyable identifier.
 */
export function CopyText({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono", className)}>
      <span className="truncate">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        aria-label="复制"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable */
          }
        }}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </span>
  );
}
