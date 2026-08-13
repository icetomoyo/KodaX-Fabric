import * as React from "react";
import { cn } from "@/lib/utils";

type ToastItem = { id: number; title: string; variant?: "default" | "destructive" };

let nextId = 1;
const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];

function emit() {
  for (const l of listeners) l(items);
}

export function toast(title: string, variant: ToastItem["variant"] = "default") {
  const id = nextId++;
  items = [...items, { id, title, variant }];
  emit();
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 4000);
}

export function Toaster() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  React.useEffect(() => {
    listeners.add(setToasts);
    setToasts(items);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "rounded-md border bg-background px-3 py-2 text-sm shadow-lg",
            t.variant === "destructive" && "border-destructive text-destructive",
          )}
        >
          {t.title}
        </div>
      ))}
    </div>
  );
}
