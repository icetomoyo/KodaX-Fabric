import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { callApi, requests } from "@/lib/api";
import { useSession } from "@/lib/session";
import { LoginCard } from "@/pages/LoginCard";
import { Shell } from "@/pages/Shell";
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
  const [name, setName] = React.useState("dev-key");
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
      await callApi(requests.createMyVkApplication({ pool_id: Number(poolId), name }));
      toast("已提交申请");
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

  return (
    <Shell title="申请 VK">
      <UsageNote origin={origin} />
      {loading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {!loading && !session ? <LoginCard allowRegister /> : null}
      {session ? (
        <div className="space-y-6">
          <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>渠道池</Label>
              <Select value={poolId} onValueChange={setPoolId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择池" />
                </SelectTrigger>
                <SelectContent>
                  {pools.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} (#{p.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={apply} disabled={!poolId}>
                提交申请
              </Button>
            </div>
          </div>
          {revealed ? (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-sm">请立即保存: {revealed}</pre>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>id</TableHead>
                <TableHead>name</TableHead>
                <TableHead>pool_id</TableHead>
                <TableHead>status</TableHead>
                <TableHead>created_vk_prefix</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.length ? (
                apps.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.id}</TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell>{a.pool_id}</TableCell>
                    <TableCell>{a.status}</TableCell>
                    <TableCell>{a.created_vk_prefix || ""}</TableCell>
                    <TableCell>
                      {a.status === "approved" ? (
                        <Button size="sm" variant="outline" onClick={() => reveal(a.id)}>
                          显示一次
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    空
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </Shell>
  );
}
