import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, KeyRound, Layers, Server, Shield, Waypoints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import {
  api,
  setToken,
  type ChannelAdmin,
  type ChannelPool,
  type Health,
  type ProviderKey,
  type VirtualKey,
  type VKApplication,
} from "@/lib/api";
import { csv } from "@/lib/utils";

type Tab = "overview" | "providers" | "pools" | "channels" | "keys" | "apps";

const tabs: { id: Tab; label: string; icon: typeof Server }[] = [
  { id: "overview", label: "总览", icon: Activity },
  { id: "providers", label: "上游钥匙", icon: Server },
  { id: "pools", label: "渠道池", icon: Layers },
  { id: "channels", label: "渠", icon: Waypoints },
  { id: "keys", label: "虚拟钥匙", icon: KeyRound },
  { id: "apps", label: "申请", icon: Shield },
];

export function AdminPage() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [providers, setProviders] = useState<ProviderKey[]>([]);
  const [pools, setPools] = useState<ChannelPool[]>([]);
  const [channels, setChannels] = useState<ChannelAdmin[]>([]);
  const [vks, setVKs] = useState<VirtualKey[]>([]);
  const [apps, setApps] = useState<VKApplication[]>([]);

  const flash = (m: string) => {
    setNote(m);
    setErr("");
    window.setTimeout(() => setNote(""), 4000);
  };
  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : "出错了");

  const reload = useCallback(async () => {
    const [h, p, po, ch, vk, ap] = await Promise.all([
      api.health().catch(() => null),
      api.listProviders(),
      api.listPools(),
      api.listChannels(),
      api.listVKs(),
      api.listApps(),
    ]);
    setHealth(h);
    setProviders(p.providers ?? []);
    setPools(po.pools ?? []);
    setChannels(ch.channels ?? []);
    setVKs(vk.virtual_keys ?? []);
    setApps(ap.applications ?? []);
  }, []);

  useEffect(() => {
    reload().catch((e) => {
      if (String(e.message).includes("admin unauthorized")) {
        setToken("");
        nav("/");
        return;
      }
      fail(e);
    });
  }, [reload, nav]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400/80">Token Hub</p>
            <h1 className="text-lg font-semibold">编目</h1>
          </div>
          <div className="flex items-center gap-3">
            <HealthDot h={health} />
            <Button
              variant="ghost"
              onClick={() => {
                setToken("");
                nav("/");
              }}
            >
              退出
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-3">
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
                  on ? "bg-white/10 text-sand-50" : "text-white/45 hover:text-sand-50"
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
        {note && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{note}</p>}

        {tab === "overview" && (
          <Overview health={health} providers={providers} pools={pools} channels={channels} vks={vks} apps={apps} />
        )}
        {tab === "providers" && (
          <ProvidersTab
            rows={providers}
            onDone={async (m) => {
              await reload();
              flash(m);
            }}
            onErr={fail}
          />
        )}
        {tab === "pools" && (
          <PoolsTab
            rows={pools}
            onDone={async (m) => {
              await reload();
              flash(m);
            }}
            onErr={fail}
          />
        )}
        {tab === "channels" && (
          <ChannelsTab
            rows={channels}
            pools={pools}
            providers={providers}
            onDone={async (m) => {
              await reload();
              flash(m);
            }}
            onErr={fail}
          />
        )}
        {tab === "keys" && (
          <VKsTab
            rows={vks}
            pools={pools}
            onDone={async (m) => {
              await reload();
              flash(m);
            }}
            onErr={fail}
          />
        )}
        {tab === "apps" && (
          <AppsTab
            rows={apps}
            pools={pools}
            onDone={async (m) => {
              await reload();
              flash(m);
            }}
            onErr={fail}
          />
        )}
      </main>
    </div>
  );
}

function HealthDot({ h }: { h: Health | null }) {
  if (!h) return <span className="text-xs text-white/30">健康未知</span>;
  return (
    <span className="flex items-center gap-2 font-mono text-xs text-white/50">
      <span className={`h-1.5 w-1.5 rounded-full ${h.ok ? "bg-emerald-400" : "bg-red-400"}`} />
      {h.ok ? "healthy" : "degraded"}
      {h.version ? ` · ${h.version}` : ""}
    </span>
  );
}

function Overview({
  health,
  providers,
  pools,
  channels,
  vks,
  apps,
}: {
  health: Health | null;
  providers: ProviderKey[];
  pools: ChannelPool[];
  channels: ChannelAdmin[];
  vks: VirtualKey[];
  apps: VKApplication[];
}) {
  const pending = apps.filter((a) => a.status === "pending").length;
  const cards = [
    { k: "上游钥匙", n: providers.length, s: `${providers.filter((p) => p.status === "active").length} active` },
    { k: "渠道池", n: pools.length, s: pools.map((p) => p.group_name).filter(Boolean).slice(0, 3).join(" / ") || "—" },
    { k: "渠", n: channels.length, s: `${channels.filter((c) => c.status === "active").length} active` },
    { k: "虚拟钥匙", n: vks.length, s: `${vks.filter((v) => v.status === "active").length} active` },
    { k: "待批申请", n: pending, s: `${apps.length} 合计` },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.k} className="p-4">
            <p className="text-xs text-white/40">{c.k}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{c.n}</p>
            <p className="mt-1 font-mono text-[11px] text-white/35">{c.s}</p>
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <p className="text-sm text-white/50">依赖</p>
        <div className="mt-3 grid gap-2 font-mono text-sm sm:grid-cols-3">
          <KV k="postgres" v={health?.postgres ? "ok" : "down"} />
          <KV k="redis" v={health?.redis ? "ok" : "down"} />
          <KV k="commit" v={health?.commit || "—"} />
        </div>
        <p className="mt-5 text-sm leading-relaxed text-white/45">
          Cursor / Claude Code 的 Base URL 填网关 Origin（本机 <code className="text-sand-100">http://127.0.0.1:3000</code>
          ），不要带 /v1。同一把 fab- 两个端点都能用。
        </p>
      </Card>
    </>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2">
      <p className="text-[11px] text-white/35">{k}</p>
      <p className="text-sand-50">{v}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="border-b border-white/10 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-white/35">{children}</th>;
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-3 py-2.5 ${mono ? "font-mono text-[12px]" : ""}`}>{children}</td>;
}

function ProvidersTab({
  rows,
  onDone,
  onErr,
}: {
  rows: ProviderKey[];
  onDone: (m: string) => Promise<void>;
  onErr: (e: unknown) => void;
}) {
  const [code, setCode] = useState("mock-openai");
  const [secret, setSecret] = useState("");
  const [rpm, setRpm] = useState("0");
  const [rot, setRot] = useState<Record<number, string>>({});

  return (
    <div className="space-y-4">
      <Card className="grid gap-3 p-4 sm:grid-cols-4">
        <Field label="provider_code">
          <Input value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="secret">
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </Field>
        <Field label="rpm_limit">
          <Input value={rpm} onChange={(e) => setRpm(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button
            onClick={() =>
              api
                .createProvider({ provider_code: code, secret, rpm_limit: Number(rpm) || 0 })
                .then(() => onDone("已录入上游钥匙"))
                .catch(onErr)
            }
          >
            录入
          </Button>
        </div>
      </Card>
      <Card className="p-2">
        <TableWrap>
          <thead>
            <tr>
              <Th>id</Th>
              <Th>provider_code</Th>
              <Th>status</Th>
              <Th>rpm</Th>
              <Th>replacement</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-white/[0.04]">
                <Td mono>{r.id}</Td>
                <Td mono>{r.provider_code}</Td>
                <Td>
                  <Badge status={r.status} />
                </Td>
                <Td mono>
                  {r.rpm_limit}/{r.rpm_burst}
                </Td>
                <Td mono>{r.has_replacement ? "staged" : "—"}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="h-8 w-36"
                      placeholder="新 secret"
                      value={rot[r.id] ?? ""}
                      onChange={(e) => setRot({ ...rot, [r.id]: e.target.value })}
                    />
                    <Button
                      variant="outline"
                      onClick={() =>
                        api
                          .rotateKey(r.id, rot[r.id] || "")
                          .then(() => onDone(`已暂存轮换 #${r.id}`))
                          .catch(onErr)
                      }
                    >
                      轮换
                    </Button>
                    {r.has_replacement && (
                      <Button
                        variant="outline"
                        onClick={() => api.activateRotate(r.id).then(() => onDone(`已激活 #${r.id}`)).catch(onErr)}
                      >
                        激活
                      </Button>
                    )}
                    <Button variant="danger" onClick={() => api.disableProvider(r.id).then(() => onDone(`已停用 #${r.id}`)).catch(onErr)}>
                      停用
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

function PoolsTab({
  rows,
  onDone,
  onErr,
}: {
  rows: ChannelPool[];
  onDone: (m: string) => Promise<void>;
  onErr: (e: unknown) => void;
}) {
  const [name, setName] = useState("default");
  const [group, setGroup] = useState("standard");
  return (
    <div className="space-y-4">
      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        <Field label="name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="group_name">
          <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="premium / standard / bulk" />
        </Field>
        <div className="flex items-end">
          <Button onClick={() => api.createPool({ name, group_name: group }).then(() => onDone("已建池")).catch(onErr)}>新建池</Button>
        </div>
      </Card>
      <Card className="p-2">
        <TableWrap>
          <thead>
            <tr>
              <Th>id</Th>
              <Th>name</Th>
              <Th>group_name</Th>
              <Th>team_id</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-white/[0.04]">
                <Td mono>{r.id}</Td>
                <Td>{r.name}</Td>
                <Td mono>{r.group_name}</Td>
                <Td mono>{r.team_id || "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

function ChannelsTab({
  rows,
  pools,
  providers,
  onDone,
  onErr,
}: {
  rows: ChannelAdmin[];
  pools: ChannelPool[];
  providers: ProviderKey[];
  onDone: (m: string) => Promise<void>;
  onErr: (e: unknown) => void;
}) {
  const [poolId, setPoolId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [proto, setProto] = useState("openai_chat");
  const [base, setBase] = useState("http://mockprovider:9090");
  const [pri, setPri] = useState("1");
  const [weight, setWeight] = useState("100");

  useEffect(() => {
    if (!poolId && pools[0]) setPoolId(String(pools[0].id));
    if (!keyId && providers[0]) setKeyId(String(providers[0].id));
  }, [pools, providers, poolId, keyId]);

  return (
    <div className="space-y-4">
      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        <Field label="pool_id">
          <Input value={poolId} onChange={(e) => setPoolId(e.target.value)} />
        </Field>
        <Field label="provider_key_id">
          <Input value={keyId} onChange={(e) => setKeyId(e.target.value)} />
        </Field>
        <Field label="protocol">
          <Input value={proto} onChange={(e) => setProto(e.target.value)} />
        </Field>
        <Field label="base_url">
          <Input value={base} onChange={(e) => setBase(e.target.value)} />
        </Field>
        <Field label="priority">
          <Input value={pri} onChange={(e) => setPri(e.target.value)} />
        </Field>
        <Field label="weight">
          <Input value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <div className="sm:col-span-3">
          <Button
            onClick={() =>
              api
                .createChannel({
                  pool_id: Number(poolId),
                  provider_key_id: Number(keyId),
                  protocol: proto,
                  base_url: base,
                  priority: Number(pri) || 0,
                  weight: Number(weight) || 100,
                })
                .then(() => onDone("已铺渠"))
                .catch(onErr)
            }
          >
            铺渠
          </Button>
        </div>
      </Card>
      <Card className="p-2">
        <TableWrap>
          <thead>
            <tr>
              <Th>id</Th>
              <Th>pool</Th>
              <Th>key</Th>
              <Th>protocol</Th>
              <Th>base_url</Th>
              <Th>pri/w</Th>
              <Th>status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-white/[0.04]">
                <Td mono>{r.id}</Td>
                <Td mono>{r.pool_id}</Td>
                <Td mono>{r.provider_key_id}</Td>
                <Td mono>{r.protocol}</Td>
                <Td mono>{r.base_url}</Td>
                <Td mono>
                  {r.priority}/{r.weight}
                </Td>
                <Td>
                  <Badge status={r.status} />
                </Td>
                <Td>
                  <Button variant="danger" onClick={() => api.disableChannel(r.id).then(() => onDone(`渠 #${r.id} 已停`)).catch(onErr)}>
                    停用
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

function VKsTab({
  rows,
  pools,
  onDone,
  onErr,
}: {
  rows: VirtualKey[];
  pools: ChannelPool[];
  onDone: (m: string) => Promise<void>;
  onErr: (e: unknown) => void;
}) {
  const [poolId, setPoolId] = useState(pools[0] ? String(pools[0].id) : "1");
  const [scope, setScope] = useState("");
  const [rpm, setRpm] = useState("0");
  const [hard, setHard] = useState("0");
  const [revealed, setRevealed] = useState("");

  return (
    <div className="space-y-4">
      {revealed && (
        <Card className="border-ember-400/30 p-4">
          <p className="text-xs text-white/40">一次性明文，只亮这一次</p>
          <code className="mt-1 block break-all font-mono text-sm text-ember-400">{revealed}</code>
        </Card>
      )}
      <Card className="grid gap-3 p-4 sm:grid-cols-4">
        <Field label="pool_id">
          <Input value={poolId} onChange={(e) => setPoolId(e.target.value)} />
        </Field>
        <Field label="model_scope（逗号）">
          <Input value={scope} onChange={(e) => setScope(e.target.value)} />
        </Field>
        <Field label="rpm_limit">
          <Input value={rpm} onChange={(e) => setRpm(e.target.value)} />
        </Field>
        <Field label="monthly_hard">
          <Input value={hard} onChange={(e) => setHard(e.target.value)} />
        </Field>
        <div className="sm:col-span-4">
          <Button
            onClick={() =>
              api
                .createVK({
                  pool_id: Number(poolId),
                  model_scope: csv(scope),
                  rpm_limit: Number(rpm) || 0,
                  monthly_hard: Number(hard) || 0,
                })
                .then((r) => {
                  setRevealed(r.plaintext);
                  return onDone("已签发 VK，请立刻复制明文");
                })
                .catch(onErr)
            }
          >
            签发 fab-
          </Button>
        </div>
      </Card>
      <Card className="p-2">
        <TableWrap>
          <thead>
            <tr>
              <Th>id</Th>
              <Th>prefix</Th>
              <Th>pool</Th>
              <Th>scope</Th>
              <Th>rpm / budget</Th>
              <Th>status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-white/[0.04]">
                <Td mono>{r.id}</Td>
                <Td mono>{r.key_masked || r.key_prefix || "—"}</Td>
                <Td mono>{r.pool_id}</Td>
                <Td mono>{(r.model_scope ?? []).join(",") || "—"}</Td>
                <Td mono>
                  {r.rpm_limit} / {r.monthly_hard}
                </Td>
                <Td>
                  <Badge status={r.status} />
                </Td>
                <Td>
                  <Button variant="danger" onClick={() => api.disableVK(r.id).then(() => onDone(`VK #${r.id} 已吊销`)).catch(onErr)}>
                    吊销
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

function AppsTab({
  rows,
  pools,
  onDone,
  onErr,
}: {
  rows: VKApplication[];
  pools: ChannelPool[];
  onDone: (m: string) => Promise<void>;
  onErr: (e: unknown) => void;
}) {
  const [poolId, setPoolId] = useState(pools[0] ? String(pools[0].id) : "1");
  const [purpose, setPurpose] = useState("");
  const [revealed, setRevealed] = useState("");

  return (
    <div className="space-y-4">
      {revealed && (
        <Card className="border-ember-400/30 p-4">
          <p className="text-xs text-white/40">批准后的一次性明文</p>
          <code className="mt-1 block break-all font-mono text-sm text-ember-400">{revealed}</code>
        </Card>
      )}
      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        <Field label="pool_id">
          <Input value={poolId} onChange={(e) => setPoolId(e.target.value)} />
        </Field>
        <Field label="purpose">
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button
            onClick={() =>
              api
                .createApp({ pool_id: Number(poolId), purpose })
                .then(() => onDone("申请已提交"))
                .catch(onErr)
            }
          >
            代提申请
          </Button>
        </div>
      </Card>
      <Card className="p-2">
        <TableWrap>
          <thead>
            <tr>
              <Th>id</Th>
              <Th>pool</Th>
              <Th>purpose</Th>
              <Th>status</Th>
              <Th>masked</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-white/[0.04]">
                <Td mono>{r.id}</Td>
                <Td mono>{r.pool_id}</Td>
                <Td>{r.purpose || "—"}</Td>
                <Td>
                  <Badge status={r.status} />
                </Td>
                <Td mono>{r.key_masked || "—"}</Td>
                <Td>
                  {r.status === "pending" && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() =>
                          api
                            .approveApp(r.id)
                            .then((x) => {
                              setRevealed(x.virtual_key);
                              return onDone("已批准，请复制明文");
                            })
                            .catch(onErr)
                        }
                      >
                        批准
                      </Button>
                      <Button variant="danger" onClick={() => api.rejectApp(r.id, "rejected").then(() => onDone("已拒绝")).catch(onErr)}>
                        拒绝
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
