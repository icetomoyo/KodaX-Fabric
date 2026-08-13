import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ClipboardList,
  GitBranch,
  Home,
  KeyRound,
  Layers,
  Server,
  Shield,
  Ticket,
  UserRound,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";

const adminItems = [
  { to: "/admin?s=providers", key: "providers", label: "供应商", icon: Server },
  { to: "/admin?s=keys", key: "keys", label: "上游密钥", icon: KeyRound },
  { to: "/admin?s=pools", key: "pools", label: "渠道池", icon: Layers },
  { to: "/admin?s=channels", key: "channels", label: "渠道", icon: GitBranch },
  { to: "/admin?s=vks", key: "vks", label: "虚拟钥匙", icon: Ticket },
  { to: "/admin?s=apps", key: "apps", label: "申请审批", icon: ClipboardList },
];

export function AppShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { session } = useSession();
  const loc = useLocation();
  const section = new URLSearchParams(loc.search).get("s") || "providers";
  const isAdmin = loc.pathname.startsWith("/admin");

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500/20 text-teal-300">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-sidebar-muted">KodaX</p>
            <p className="text-sm font-semibold leading-none">Token Hub</p>
          </div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
          <NavGroup label="工作台">
            <NavLink to="/" active={loc.pathname === "/"} icon={Home}>
              总览
            </NavLink>
          </NavGroup>
          {session?.role === "admin" ? (
            <NavGroup label="接入管理">
              {adminItems.map((item) => (
                <NavLink key={item.key} to={item.to} active={isAdmin && section === item.key} icon={item.icon}>
                  {item.label}
                </NavLink>
              ))}
            </NavGroup>
          ) : null}
          <NavGroup label="开发者">
            <NavLink to="/me" active={loc.pathname.startsWith("/me")} icon={UserRound}>
              申请虚拟钥匙
            </NavLink>
          </NavGroup>
        </nav>
        <div className="border-t border-white/10 px-4 py-4 text-xs text-sidebar-muted">
          内部试用 · 0.1.0
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b bg-card/90 backdrop-blur">
          <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-8">
            <div>
              <p className="text-xs text-muted-foreground md:hidden">KodaX Token Hub</p>
              <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <nav className="flex gap-1 text-sm md:hidden">
                <Link className="rounded-md px-2 py-1 hover:bg-muted" to="/">
                  总览
                </Link>
                <Link className="rounded-md px-2 py-1 hover:bg-muted" to="/admin">
                  管理
                </Link>
                <Link className="rounded-md px-2 py-1 hover:bg-muted" to="/me">
                  申请
                </Link>
              </nav>
              {session ? (
                <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5">
                  <span className="text-sm font-medium">{session.name || session.phone}</span>
                  <StatusBadge value={session.role} />
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavLink({
  to,
  active,
  icon: Icon,
  children,
}: {
  to: string;
  active: boolean;
  icon: typeof Home;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
        active ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      {children}
    </Link>
  );
}
