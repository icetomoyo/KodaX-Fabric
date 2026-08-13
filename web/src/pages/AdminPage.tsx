import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { callApi, requests } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AppShell } from "@/pages/AppShell";
import { LoginCard } from "@/pages/LoginCard";

type Row = Record<string, unknown>;

function cell(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

type Col = { key: string; label: string; render?: (row: Row) => React.ReactNode };

function DataTable({ rows, cols, action, empty }: { rows: Row[]; cols: Col[]; action?: (row: Row) => React.ReactNode; empty: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {cols.map((c) => (
            <TableHead key={c.key}>{c.label}</TableHead>
          ))}
          {action ? <TableHead className="text-right">操作</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length ? (
          rows.map((r, i) => (
            <TableRow key={cell(r.id) || i}>
              {cols.map((c) => (
                <TableCell key={c.key}>{c.render ? c.render(r) : cell(r[c.key])}</TableCell>
              ))}
              {action ? <TableCell className="text-right">{action(r)}</TableCell> : null}
            </TableRow>
          ))
        ) : (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={cols.length + (action ? 1 : 0)} className="py-12 text-center text-muted-foreground">
              {empty}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const titles: Record<string, { title: string; desc: string }> = {
  providers: { title: "供应商", desc: "上游模型厂家，例如 DeepSeek、OpenAI。" },
  keys: { title: "上游密钥", desc: "官方 Key 加密入库。明文只在录入时提交，列表永不回显。" },
  pools: { title: "渠道池", desc: "虚拟钥匙绑定到池，而不是绑死某一条渠。" },
  channels: { title: "渠道", desc: "池内的一条上游通路：协议、地址、优先级与权重。" },
  vks: { title: "虚拟钥匙", desc: "发给调用方的 fab- 钥匙。同一把可走两个端点。" },
  apps: { title: "申请审批", desc: "开发者提交的虚拟钥匙申请。" },
};

export function AdminPage() {
  const { session, loading } = useSession();
  const [params] = useSearchParams();
  const section = titles[params.get("s") || ""] ? params.get("s") || "providers" : "providers";
  const [providers, setProviders] = React.useState<Row[]>([]);
  const [keys, setKeys] = React.useState<Row[]>([]);
  const [pools, setPools] = React.useState<Row[]>([]);
  const [channels, setChannels] = React.useState<Row[]>([]);
  const [vks, setVks] = React.useState<Row[]>([]);
  const [apps, setApps] = React.useState<Row[]>([]);
  const [once, setOnce] = React.useState("");

  const refresh = React.useCallback(async () => {
    const [p, k, o, c, v, a] = await Promise.all([
      callApi<Row[]>(requests.listProviders()),
      callApi<Row[]>(requests.listProviderKeys()),
      callApi<Row[]>(requests.listPools()),
      callApi<Row[]>(requests.listChannels()),
      callApi<Row[]>(requests.listVirtualKeys()),
      callApi<Row[]>(requests.listVkApplications()),
    ]);
    setProviders(p.data || []);
    setKeys(k.data || []);
    setPools(o.data || []);
    setChannels(c.data || []);
    setVks(v.data || []);
    setApps(a.data || []);
  }, []);

  React.useEffect(() => {
    if (session?.role !== "admin") return;
    refresh().catch((e) => toast(e instanceof Error ? e.message : "加载失败", "destructive"));
  }, [session, refresh]);

  async function run(fn: () => Promise<void>) {
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作失败", "destructive");
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">加载中…</div>;
  }
  if (!session) return <LoginCard allowRegister={false} />;

  const meta = titles[section];

  return (
    <AppShell title={meta.title} description={meta.desc}>
      {session.role !== "admin" ? (
        <Card>
          <CardHeader>
            <CardTitle>需要管理员权限</CardTitle>
            <CardDescription>
              当前账号 {session.phone} 是开发者，只能申请虚拟钥匙，不能改接入配置。
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {once ? (
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader>
                <CardTitle>请立即保存这把钥匙</CardTitle>
                <CardDescription>明文只出现这一次，关闭页面后无法再看。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <code className="break-all text-sm">{once}</code>
                <CopyButton text={once} />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader className="flex-row items-center justify-end space-y-0 pb-2">
              {section === "providers" ? (
                <CreateProvider onCreate={(input) => run(async () => { await callApi(requests.createProvider(input)); })} />
              ) : null}
              {section === "keys" ? (
                <CreateKey
                  providers={providers}
                  onCreate={(input) => run(async () => { await callApi(requests.createProviderKey(input)); })}
                />
              ) : null}
              {section === "pools" ? (
                <CreatePool onCreate={(input) => run(async () => { await callApi(requests.createPool(input)); })} />
              ) : null}
              {section === "channels" ? (
                <CreateChannel
                  pools={pools}
                  keys={keys}
                  onCreate={(input) => run(async () => { await callApi(requests.createChannel(input)); })}
                />
              ) : null}
              {section === "vks" ? (
                <CreateVK
                  pools={pools}
                  onCreate={async (input) => {
                    await run(async () => {
                      const out = await callApi<{ id: number; virtual_key: string }>(requests.createVirtualKey(input));
                      setOnce(out.data.virtual_key);
                    });
                  }}
                />
              ) : null}
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {section === "providers" ? (
                <DataTable
                  empty="还没有供应商。先添加一家上游。"
                  rows={providers}
                  cols={[
                    { key: "id", label: "编号" },
                    { key: "name", label: "名称" },
                    { key: "code", label: "代码" },
                    { key: "default_base_url", label: "默认地址" },
                  ]}
                />
              ) : null}
              {section === "keys" ? (
                <DataTable
                  empty="还没有上游密钥。"
                  rows={keys}
                  cols={[
                    { key: "id", label: "编号" },
                    { key: "provider_code", label: "供应商" },
                    { key: "label", label: "备注" },
                    { key: "status", label: "状态", render: (r) => <StatusBadge value={cell(r.status)} /> },
                  ]}
                  action={(row) => (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        run(async () => {
                          const next = cell(row.status) === "active" ? "disabled" : "active";
                          await callApi(requests.setProviderKeyStatus(Number(row.id), next));
                        })
                      }
                    >
                      {cell(row.status) === "active" ? "停用" : "启用"}
                    </Button>
                  )}
                />
              ) : null}
              {section === "pools" ? (
                <DataTable
                  empty="还没有渠道池。"
                  rows={pools}
                  cols={[
                    { key: "id", label: "编号" },
                    { key: "name", label: "名称" },
                    { key: "group_name", label: "分组" },
                  ]}
                />
              ) : null}
              {section === "channels" ? (
                <DataTable
                  empty="还没有渠道。"
                  rows={channels}
                  cols={[
                    { key: "id", label: "编号" },
                    { key: "pool_id", label: "池" },
                    { key: "label", label: "密钥" },
                    { key: "protocol", label: "协议" },
                    { key: "base_url", label: "地址" },
                    { key: "priority", label: "优先级" },
                    { key: "weight", label: "权重" },
                    { key: "status", label: "状态", render: (r) => <StatusBadge value={cell(r.status)} /> },
                  ]}
                />
              ) : null}
              {section === "vks" ? (
                <DataTable
                  empty="还没有签发虚拟钥匙。"
                  rows={vks}
                  cols={[
                    { key: "id", label: "编号" },
                    { key: "name", label: "名称" },
                    { key: "key_prefix", label: "前缀" },
                    { key: "pool_id", label: "池" },
                    { key: "rpm_limit", label: "RPM" },
                    { key: "monthly_token_limit", label: "月预算" },
                    { key: "monthly_tokens_used", label: "本月已用" },
                    { key: "status", label: "状态", render: (r) => <StatusBadge value={cell(r.status)} /> },
                  ]}
                  action={(row) =>
                    cell(row.status) === "revoked" ? null : (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => run(async () => { await callApi(requests.revokeVirtualKey(Number(row.id))); })}
                      >
                        吊销
                      </Button>
                    )
                  }
                />
              ) : null}
              {section === "apps" ? (
                <DataTable
                  empty="暂时没有申请。"
                  rows={apps}
                  cols={[
                    { key: "id", label: "编号" },
                    { key: "name", label: "名称" },
                    { key: "operator_id", label: "申请人" },
                    { key: "pool_id", label: "池" },
                    { key: "created_vk_prefix", label: "钥匙前缀" },
                    { key: "status", label: "状态", render: (r) => <StatusBadge value={cell(r.status)} /> },
                  ]}
                  action={(row) =>
                    cell(row.status) === "pending" ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          run(async () => {
                            const out = await callApi<{ virtual_key: string }>(requests.approveVkApplication(Number(row.id)));
                            setOnce(out.data.virtual_key);
                            toast("已批准，开发者可在「申请虚拟钥匙」里显示一次");
                          })
                        }
                      >
                        批准
                      </Button>
                    ) : null
                  }
                />
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </AppShell>
  );
}

function CreateProvider({ onCreate }: { onCreate: (v: { code: string; name: string; default_base_url: string }) => void }) {
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [base, setBase] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          添加供应商
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加供应商</DialogTitle>
          <DialogDescription>填写厂家代码和默认上游地址。</DialogDescription>
        </DialogHeader>
        <Field label="代码" hint="例如 deepseek">
          <Input value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="显示名称">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="默认地址">
          <Input placeholder="https://" value={base} onChange={(e) => setBase(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              onCreate({ code, name, default_base_url: base });
              setOpen(false);
            }}
          >
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateKey({
  providers,
  onCreate,
}: {
  providers: Row[];
  onCreate: (v: { provider_code: string; label: string; secret: string }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [provider_code, setCode] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [secret, setSecret] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          录入密钥
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>录入上游密钥</DialogTitle>
          <DialogDescription>官方 Key 会加密保存，之后无法从列表看到明文。</DialogDescription>
        </DialogHeader>
        <Field label="供应商">
          <Select value={provider_code} onValueChange={setCode}>
            <SelectTrigger>
              <SelectValue placeholder="选择供应商" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={cell(p.code)} value={cell(p.code)}>
                  {cell(p.name)} ({cell(p.code)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="备注">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如 生产 / 备用" />
        </Field>
        <Field label="官方密钥">
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              onCreate({ provider_code, label, secret });
              setSecret("");
              setOpen(false);
            }}
          >
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreatePool({ onCreate }: { onCreate: (v: { name: string; group_name: string }) => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [group, setGroup] = React.useState("standard");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          新建渠道池
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建渠道池</DialogTitle>
        </DialogHeader>
        <Field label="名称">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="分组">
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">standard 标准</SelectItem>
              <SelectItem value="premium">premium 高优先级</SelectItem>
              <SelectItem value="bulk">bulk 批量</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              onCreate({ name, group_name: group });
              setOpen(false);
            }}
          >
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateChannel({
  pools,
  keys,
  onCreate,
}: {
  pools: Row[];
  keys: Row[];
  onCreate: (v: {
    pool_id: number;
    provider_key_id: number;
    protocol: string;
    base_url: string;
    priority: number;
    weight: number;
  }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [pool_id, setPool] = React.useState("");
  const [provider_key_id, setKey] = React.useState("");
  const [protocol, setProto] = React.useState("openai_chat");
  const [base_url, setBase] = React.useState("");
  const [priority, setPri] = React.useState("0");
  const [weight, setW] = React.useState("100");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          添加渠道
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加渠道</DialogTitle>
          <DialogDescription>渠道挂在某个池上，并绑定一把上游密钥。</DialogDescription>
        </DialogHeader>
        <Field label="渠道池">
          <Select value={pool_id} onValueChange={setPool}>
            <SelectTrigger>
              <SelectValue placeholder="选择池" />
            </SelectTrigger>
            <SelectContent>
              {pools.map((p) => (
                <SelectItem key={cell(p.id)} value={cell(p.id)}>
                  {cell(p.name)} #{cell(p.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="上游密钥">
          <Select value={provider_key_id} onValueChange={setKey}>
            <SelectTrigger>
              <SelectValue placeholder="选择密钥" />
            </SelectTrigger>
            <SelectContent>
              {keys.map((k) => (
                <SelectItem key={cell(k.id)} value={cell(k.id)}>
                  {cell(k.label)} · {cell(k.provider_code)} #{cell(k.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="协议">
          <Select value={protocol} onValueChange={setProto}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai_chat">OpenAI Chat Completions</SelectItem>
              <SelectItem value="anthropic_messages">Anthropic Messages</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="上游地址">
          <Input placeholder="https://" value={base_url} onChange={(e) => setBase(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="优先级">
            <Input value={priority} onChange={(e) => setPri(e.target.value)} />
          </Field>
          <Field label="权重">
            <Input value={weight} onChange={(e) => setW(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              onCreate({
                pool_id: Number(pool_id),
                provider_key_id: Number(provider_key_id),
                protocol,
                base_url,
                priority: Number(priority),
                weight: Number(weight),
              });
              setOpen(false);
            }}
          >
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateVK({
  pools,
  onCreate,
}: {
  pools: Row[];
  onCreate: (v: {
    name: string;
    model_scope: string;
    ip_whitelist: string;
    pool_id: number;
    rpm_limit: number;
    monthly_token_limit: number;
  }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [pool_id, setPool] = React.useState("");
  const [rpm, setRpm] = React.useState("60");
  const [budget, setBudget] = React.useState("0");
  const [models, setModels] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          签发钥匙
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>签发虚拟钥匙</DialogTitle>
          <DialogDescription>签发后明文只显示一次。0 表示不限额。</DialogDescription>
        </DialogHeader>
        <Field label="名称">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 cursor-team-a" />
        </Field>
        <Field label="渠道池">
          <Select value={pool_id} onValueChange={setPool}>
            <SelectTrigger>
              <SelectValue placeholder="选择池" />
            </SelectTrigger>
            <SelectContent>
              {pools.map((p) => (
                <SelectItem key={cell(p.id)} value={cell(p.id)}>
                  {cell(p.name)} #{cell(p.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="每分钟请求上限">
            <Input value={rpm} onChange={(e) => setRpm(e.target.value)} />
          </Field>
          <Field label="月 Token 预算">
            <Input value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
        </div>
        <Field label="模型范围" hint="留空表示不限制。多个模型用逗号分隔。">
          <Input value={models} onChange={(e) => setModels(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              onCreate({
                name,
                pool_id: Number(pool_id),
                rpm_limit: Number(rpm),
                monthly_token_limit: Number(budget),
                model_scope: models,
                ip_whitelist: "",
              });
              setOpen(false);
            }}
          >
            签发
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
