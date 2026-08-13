import * as React from "react";
import { CopyButton } from "@/components/CopyButton";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { callApi, requests } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AppShell } from "@/pages/AppShell";
import { LoginCard } from "@/pages/LoginCard";
import { UsageNote } from "@/pages/UsageNote";

type Pool = { id: number; name: string; group_name?: string };
type AppRow = {
  id: number;
  name: string;
  pool_id: number;
  status: string;
  created_vk_prefix?: string;
};

export function DeveloperPage() {
  const { session, loading } = useSession();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [pools, setPools] = React.useState<Pool[]>([]);
  const [apps, setApps] = React.useState<AppRow[]>([]);
  const [poolId, setPoolId] = React.useState("");
  const [name, setName] = React.useState("");
  const [revealed, setRevealed] = React.useState("");

  const load = React.useCallback(async () => {
    const [p, a] = await Promise.all([
      callApi<Pool[]>(requests.listPools()),
      callApi<AppRow[]>(requests.listMyVkApplications()),
    ]);
    setPools(p.data || []);
    setApps(a.data || []);
    if (!poolId && p.data?.length) setPoolId(String(p.data[0].id));
  }, [poolId]);

  React.useEffect(() => {
    if (!session) return;
    load().catch((e) => toast(e instanceof Error ? e.message : "加载失败", "destructive"));
  }, [session, load]);

  async function apply() {
    try {
      await callApi(requests.createMyVkApplication({ pool_id: Number(poolId), name: name || "dev-key" }));
      toast("申请已提交，等待管理员批准");
      setName("");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "申请失败", "destructive");
    }
  }

  async function reveal(id: number) {
    try {
      const out = await callApi<{ virtual_key: string }>(requests.revealMyVkApplication(id));
      setRevealed(out.data.virtual_key);
      toast("钥匙仅显示一次，请立即保存");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "显示失败", "destructive");
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">加载中…</div>;
  }
  if (!session) return <LoginCard allowRegister />;

  return (
    <AppShell title="申请虚拟钥匙" description="提交申请，批准后只能查看明文一次。">
      <UsageNote origin={origin} />
      <Card>
        <CardHeader>
          <CardTitle>新申请</CardTitle>
          <CardDescription>选择渠道池，写一个方便辨认的名称。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-2">
            <Label>渠道池</Label>
            <Select value={poolId} onValueChange={setPoolId}>
              <SelectTrigger>
                <SelectValue placeholder="选择池" />
              </SelectTrigger>
              <SelectContent>
                {pools.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 我的 Cursor" />
          </div>
          <div className="flex items-end">
            <Button onClick={apply} disabled={!poolId}>
              提交申请
            </Button>
          </div>
        </CardContent>
      </Card>
      {revealed ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle>请立即保存</CardTitle>
            <CardDescription>这把 fab- 钥匙关闭后无法再显示。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <code className="break-all text-sm">{revealed}</code>
            <CopyButton text={revealed} />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>我的申请</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>编号</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>渠道池</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>钥匙前缀</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.length ? (
                apps.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.id}</TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell>{pools.find((p) => p.id === a.pool_id)?.name || a.pool_id}</TableCell>
                    <TableCell>
                      <StatusBadge value={a.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.created_vk_prefix || "—"}</TableCell>
                    <TableCell className="text-right">
                      {a.status === "approved" ? (
                        <Button size="sm" variant="outline" onClick={() => reveal(a.id)}>
                          显示一次
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    还没有申请。提交后会显示在这里。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
