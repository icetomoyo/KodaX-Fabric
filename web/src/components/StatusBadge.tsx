import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const map: Record<string, { label: string; className: string }> = {
  active: { label: "可用", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  disabled: { label: "停用", className: "border-slate-200 bg-slate-100 text-slate-600" },
  revoked: { label: "已吊销", className: "border-red-200 bg-red-50 text-red-700" },
  pending: { label: "待审批", className: "border-amber-200 bg-amber-50 text-amber-800" },
  approved: { label: "已批准", className: "border-teal-200 bg-teal-50 text-teal-800" },
  admin: { label: "管理员", className: "border-teal-200 bg-teal-50 text-teal-800" },
  developer: { label: "开发者", className: "border-sky-200 bg-sky-50 text-sky-800" },
};

export function StatusBadge({ value }: { value: string }) {
  const item = map[value] || { label: value, className: "border-slate-200 bg-slate-50 text-slate-700" };
  return (
    <Badge variant="outline" className={cn("font-medium", item.className)}>
      {item.label}
    </Badge>
  );
}
