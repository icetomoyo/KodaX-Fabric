import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { callApi, requests } from "@/lib/api";
import { useSession } from "@/lib/session";
import { LoginCard } from "@/pages/LoginCard";
import { Shell } from "@/pages/Shell";
import { UsageNote } from "@/pages/UsageNote";

type Row = Record<string, unknown>;

function cell(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function DataTable({ rows, cols, action }: { rows: Row[]; cols: string[]; action?: (row: Row) => React.ReactNode }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {cols.map((c) => (
            <TableHead key={c}>{c}</TableHead>
          ))}
          {action ? <TableHead /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length ? (
          rows.map((r, i) => (
            <TableRow key={cell(r.id) || i}>
              {cols.map((c) => (
                <TableCell key={c}>{cell(r[c])}</TableCell>
              ))}
              {action ? <TableCell>{action(r)}</TableCell> : null}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={cols.length + (action ? 1 : 0)} className="text-muted-foreground">
              空
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function AdminPage() {
  const { session, loading } = useSession();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
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

  return (
    <Shell title="管理后台">
      <UsageNote origin={origin} />
      {loading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {!loading && !session ? <LoginCard allowRegister={false} /> : null}
      {session && session.role !== "admin" ? (
        <p className="text-sm text-destructive">需要管理员账号。当前 {session.phone} / {session.role}</p>
      ) : null}
      {session?.role === "admin" ? (
        <Tabs defaultValue="providers">
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="keys">上游 Key</TabsTrigger>
            <TabsTrigger value="pools">渠道池</TabsTrigger>
            <TabsTrigger value="channels">渠道</TabsTrigger>
            <TabsTrigger value="vks">Virtual Keys</TabsTrigger>
            <TabsTrigger value="apps">VK 申请</TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="space-y-3">
            <CreateProvider onCreate={(input) => run(async () => { await callApi(requests.createProvider(input)); })} />
            <DataTable rows={providers} cols={["id", "code", "name", "default_base_url"]} />
          </TabsContent>

          <TabsContent value="keys" className="space-y-3">
            <p className="text-sm text-muted-foreground">明文 secret 只在创建时提交，列表永不回显。</p>
            <CreateKey
              onCreate={(input) =>
                run(async () => {
                  await callApi(requests.createProviderKey(input));
                })
              }
            />
            <DataTable
              rows={keys}
              cols={["id", "provider_code", "label", "status"]}
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
                  切换状态
                </Button>
              )}
            />
          </TabsContent>

          <TabsContent value="pools" className="space-y-3">
            <CreatePool onCreate={(input) => run(async () => { await callApi(requests.createPool(input)); })} />
            <DataTable rows={pools} cols={["id", "name", "group_name"]} />
          </TabsContent>

          <TabsContent value="channels" className="space-y-3">
            <CreateChannel
              onCreate={(input) =>
                run(async () => {
                  await callApi(requests.createChannel(input));
                })
              }
            />
            <DataTable rows={channels} cols={["id", "pool_id", "provider_key_id", "protocol", "base_url", "status", "priority", "weight"]} />
          </TabsContent>

          <TabsContent value="vks" className="space-y-3">
            {once ? <pre className="overflow-auto rounded-md bg-muted p-3 text-sm">仅显示一次: {once}</pre> : null}
            <CreateVK
              onCreate={async (input) => {
                await run(async () => {
                  const out = await callApi<{ id: number; virtual_key: string }>(requests.createVirtualKey(input));
                  setOnce(out.data.virtual_key);
                });
              }}
            />
            <DataTable
              rows={vks}
              cols={["id", "key_prefix", "name", "pool_id", "status", "rpm_limit", "monthly_token_limit", "monthly_tokens_used"]}
              action={(row) =>
                cell(row.status) === "revoked" ? null : (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      run(async () => {
                        await callApi(requests.revokeVirtualKey(Number(row.id)));
                      })
                    }
                  >
                    吊销
                  </Button>
                )
              }
            />
          </TabsContent>

          <TabsContent value="apps" className="space-y-3">
            <DataTable
              rows={apps}
              cols={["id", "operator_id", "pool_id", "name", "status", "created_vk_prefix"]}
              action={(row) =>
                cell(row.status) === "pending" ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        const out = await callApi<{ virtual_key: string }>(requests.approveVkApplication(Number(row.id)));
                        setOnce(out.data.virtual_key);
                        toast("已签发，开发者可在 /me 显示一次");
                      })
                    }
                  >
                    批准
                  </Button>
                ) : null
              }
            />
          </TabsContent>
        </Tabs>
      ) : null}
    </Shell>
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
        <Button size="sm">添加 Provider</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加 Provider</DialogTitle>
        </DialogHeader>
        <Field label="code">
          <Input value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="default_base_url">
          <Input value={base} onChange={(e) => setBase(e.target.value)} />
        </Field>
        <Button
          onClick={() => {
            onCreate({ code, name, default_base_url: base });
            setOpen(false);
          }}
        >
          保存
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function CreateKey({
  onCreate,
}: {
  onCreate: (v: { provider_code: string; label: string; secret: string }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [provider_code, setCode] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [secret, setSecret] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">添加上游 Key</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加上游 Key</DialogTitle>
        </DialogHeader>
        <Field label="provider_code">
          <Input value={provider_code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="label">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="secret（明文只提交一次）">
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </Field>
        <Button
          onClick={() => {
            onCreate({ provider_code, label, secret });
            setSecret("");
            setOpen(false);
          }}
        >
          保存
        </Button>
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
        <Button size="sm">添加渠道池</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加渠道池</DialogTitle>
        </DialogHeader>
        <Field label="name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="group_name">
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">standard</SelectItem>
              <SelectItem value="premium">premium</SelectItem>
              <SelectItem value="bulk">bulk</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Button
          onClick={() => {
            onCreate({ name, group_name: group });
            setOpen(false);
          }}
        >
          保存
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function CreateChannel({
  onCreate,
}: {
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
  const [pool_id, setPool] = React.useState("1");
  const [provider_key_id, setKey] = React.useState("1");
  const [protocol, setProto] = React.useState("openai_chat");
  const [base_url, setBase] = React.useState("");
  const [priority, setPri] = React.useState("0");
  const [weight, setW] = React.useState("100");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">添加渠道</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加渠道</DialogTitle>
        </DialogHeader>
        <Field label="pool_id">
          <Input value={pool_id} onChange={(e) => setPool(e.target.value)} />
        </Field>
        <Field label="provider_key_id">
          <Input value={provider_key_id} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Field label="protocol">
          <Select value={protocol} onValueChange={setProto}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai_chat">openai_chat</SelectItem>
              <SelectItem value="anthropic_messages">anthropic_messages</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="base_url">
          <Input value={base_url} onChange={(e) => setBase(e.target.value)} />
        </Field>
        <Field label="priority">
          <Input value={priority} onChange={(e) => setPri(e.target.value)} />
        </Field>
        <Field label="weight">
          <Input value={weight} onChange={(e) => setW(e.target.value)} />
        </Field>
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
      </DialogContent>
    </Dialog>
  );
}

function CreateVK({
  onCreate,
}: {
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
  const [pool_id, setPool] = React.useState("1");
  const [rpm, setRpm] = React.useState("60");
  const [budget, setBudget] = React.useState("0");
  const [models, setModels] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">签发 VK</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>签发 Virtual Key</DialogTitle>
        </DialogHeader>
        <Field label="name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="pool_id">
          <Input value={pool_id} onChange={(e) => setPool(e.target.value)} />
        </Field>
        <Field label="rpm_limit">
          <Input value={rpm} onChange={(e) => setRpm(e.target.value)} />
        </Field>
        <Field label="monthly_token_limit">
          <Input value={budget} onChange={(e) => setBudget(e.target.value)} />
        </Field>
        <Field label="model_scope">
          <Input value={models} onChange={(e) => setModels(e.target.value)} />
        </Field>
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
      </DialogContent>
    </Dialog>
  );
}
