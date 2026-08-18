import { NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  BookOpen,
  Building2,
  KeyRound,
  ListOrdered,
  LogOut,
  Server,
  Table2,
  Tags,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useHealth } from "@/lib/query/hooks";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/admin/overview", label: "用量总览", icon: Activity },
  { to: "/admin/requests", label: "请求流水", icon: ListOrdered },
  { to: "/admin/projects", label: "项目", icon: Building2 },
  { to: "/admin/keys", label: "虚拟钥匙", icon: KeyRound },
  { to: "/admin/providers", label: "上游 Provider", icon: Server },
  { to: "/admin/models", label: "Model 映射", icon: Tags },
  { to: "/admin/prices", label: "价格表", icon: Table2 },
  { to: "/admin/docs", label: "接口文档", icon: BookOpen },
];

export default function AdminLayout() {
  const { operator, logout } = useAuth();
  const health = useHealth();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            K
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-foreground">KodaX Fabric</div>
            <div className="text-xs text-muted-foreground">管理控制台</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map((t) => {
            const Icon = t.icon;
            return (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  cn(
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                <Icon size={16} strokeWidth={1.8} />
                {t.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-border px-5 py-4">
          <span className="block text-xs text-muted-foreground">管理员</span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-card px-8">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                health.data?.ok ? "bg-emerald-500" : "bg-slate-300",
              )}
            />
            {health.data?.ok ? "服务正常" : "状态未知"}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {operator?.name || operator?.username}
            </span>
            <button
              onClick={() => void logout()}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut size={15} />
              退出
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-8 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
