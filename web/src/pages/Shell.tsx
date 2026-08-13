import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  const { session } = useSession();
  const loc = useLocation();
  const links = [
    { to: "/", label: "首页" },
    { to: "/admin", label: "管理后台" },
    { to: "/me", label: "申请 VK" },
  ];
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-sm text-muted-foreground">Token Hub</p>
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={cn(
                  "rounded-md px-2 py-1 hover:bg-accent",
                  loc.pathname === l.to && "bg-accent font-medium",
                )}
              >
                {l.label}
              </Link>
            ))}
            {session ? (
              <Badge variant="secondary">
                {session.phone} / {session.role}
              </Badge>
            ) : null}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
