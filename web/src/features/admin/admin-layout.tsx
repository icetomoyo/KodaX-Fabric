import { NavLink, Link, Outlet } from "react-router-dom";
import { Activity, KeyRound, Layers, Server, Users, Waypoints } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useHealth } from "@/lib/query/hooks";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/admin/overview", label: "总览", icon: Activity },
  { to: "/admin/users", label: "用户", icon: Users },
  { to: "/admin/providers", label: "上游钥匙", icon: Server },
  { to: "/admin/pools", label: "渠道池", icon: Layers },
  { to: "/admin/channels", label: "渠", icon: Waypoints },
  { to: "/admin/keys", label: "虚拟钥匙", icon: KeyRound },
];

export default function AdminLayout() {
  const { operator, logout } = useAuth();
  const health = useHealth();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border bg-card/60 px-3 py-6">
        <div className="px-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400/80">
            Token Hub
          </p>
          <div className="font-serif text-lg">编目</div>
        </div>
        <nav className="mt-8 space-y-1">
          {nav.map((t) => {
            const Icon = t.icon;
            return (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                <Icon size={14} />
                {t.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2 px-3 text-sm">
          <Link
            to="/app"
            className="block text-muted-foreground transition-colors hover:text-foreground"
          >
            我的工作台
          </Link>
          <button
            onClick={() => void logout()}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            退出
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-8 py-8">
        <div className="mb-6 flex items-center justify-end">
          <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                health.data?.ok ? "bg-emerald-400" : "bg-white/20",
              )}
            />
            {health.data?.ok ? "healthy" : "health unknown"}
          </span>
        </div>
        <p className="sr-only">{operator?.name || operator?.phone}</p>
        <Outlet />
      </main>
    </div>
  );
}
