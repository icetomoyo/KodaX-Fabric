import * as React from "react";
import { Link } from "react-router-dom";
import { ClipboardList, KeyRound, Layers, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { callApi, requests } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AppShell } from "@/pages/AppShell";
import { LoginCard } from "@/pages/LoginCard";
import { UsageNote } from "@/pages/UsageNote";

type Row = Record<string, unknown>;

export function HomePage() {
  const { session, loading } = useSession();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [stats, setStats] = React.useState({ providers: 0, pools: 0, vks: 0, pending: 0 });

  React.useEffect(() => {
    if (!session) return;
    const load = async () => {
      if (session.role === "admin") {
        const [p, o, v, a] = await Promise.all([
          callApi<Row[]>(requests.listProviders()),
          callApi<Row[]>(requests.listPools()),
          callApi<Row[]>(requests.listVirtualKeys()),
          callApi<Row[]>(requests.listVkApplications()),
        ]);
        setStats({
          providers: p.data?.length || 0,
          pools: o.data?.length || 0,
          vks: v.data?.length || 0,
          pending: (a.data || []).filter((x) => x.status === "pending").length,
        });
        return;
      }
      const a = await callApi<Row[]>(requests.listMyVkApplications());
      setStats({
        providers: 0,
        pools: 0,
        vks: (a.data || []).filter((x) => x.status === "approved").length,
        pending: (a.data || []).filter((x) => x.status === "pending").length,
      });
    };
    load().catch((e) => toast(e instanceof Error ? e.message : "加载失败", "destructive"));
  }, [session]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">加载中…</div>;
  }
  if (!session) return <LoginCard />;

  const cards =
    session.role === "admin"
      ? [
          { label: "供应商", value: stats.providers, icon: Server, to: "/admin?s=providers" },
          { label: "渠道池", value: stats.pools, icon: Layers, to: "/admin?s=pools" },
          { label: "虚拟钥匙", value: stats.vks, icon: KeyRound, to: "/admin?s=vks" },
          { label: "待审批", value: stats.pending, icon: ClipboardList, to: "/admin?s=apps" },
        ]
      : [
          { label: "已批准钥匙", value: stats.vks, icon: KeyRound, to: "/me" },
          { label: "待审批申请", value: stats.pending, icon: ClipboardList, to: "/me" },
        ];

  return (
    <AppShell title="总览" description="Token Hub 0.1.0 · 公司内部过渡版">
      <div className={`grid gap-4 ${session.role === "admin" ? "sm:grid-cols-4" : "sm:grid-cols-2"}`}>
        {cards.map((c) => (
          <Link key={c.label} to={c.to}>
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-sm text-muted-foreground">{c.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <c.icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <UsageNote origin={origin} />
      <div className="flex flex-wrap gap-2">
        {session.role === "admin" ? (
          <Button asChild>
            <Link to="/admin?s=providers">进入接入管理</Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link to="/me">申请虚拟钥匙</Link>
        </Button>
      </div>
    </AppShell>
  );
}
