import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, KeyRound, Layers, Server, Users, Waypoints } from "lucide-react";
import type { Session } from "@/App";
import {
  api,
  type Channel,
  type Operator,
  type Overview,
  type Pool,
  type ProviderKey,
  type VirtualKey,
} from "@/lib/api";
import { Banner, Status } from "@/pages/UserPage";

type Tab = "overview" | "users" | "providers" | "pools" | "channels" | "keys";

const tabs: { id: Tab; label: string; icon: typeof Server }[] = [
  { id: "overview", label: "总览", icon: Activity },
  { id: "users", label: "用户", icon: Users },
  { id: "providers", label: "上游钥匙", icon: Server },
  { id: "pools", label: "渠道池", icon: Layers },
  { id: "channels", label: "渠", icon: Waypoints },
  { id: "keys", label: "虚拟钥匙", icon: KeyRound },
];

export function AdminPage({
  session,
  setSession,
}: {
  session: Session;
  setSession: (s: Session) => void;
}) {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [ov, setOv] = useState<Overview | null>(null);
  const [users, setUsers] = useState<Operator[]>([]);
  const [providers, setProviders] = useState<ProviderKey[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [vks, setVKs] = useState<VirtualKey[]>([]);
  const [health, setHealth] = useState<{ ok?: boolean } | null>(null);

  const flash = (m: string) => {
    setNote(m);
    setErr("");
    window.setTimeout(() => setNote(""), 4000);
  };
  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : "出错了");

  const reload = useCallback(async () => {
    const [h, o, u, p, po, ch, vk] = await Promise.all([
      api.health().catch(() => null),
      api.overview(),
      api.users(),
      api.providerKeys(),
      api.pools(),
      api.channels(),
      api.virtualKeys(),
    ]);
    setHealth(h);
    setOv(o);
    setUsers(u.users ?? []);
    setProviders(p.provider_keys ?? []);
    setPools(po.pools ?? []);
    setChannels(ch.channels ?? []);
    setVKs(vk.virtual_keys ?? []);
  }, []);

  useEffect(() => {
    reload().catch(fail);
  }, [reload]);

  async function logout() {
    await api.logout().catch(() => {});
    setSession({ operator: null, ready: true });
    nav("/");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/80 px-3 py-6">
        <div className="px-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400/80">Token Hub</p>
          <div className="font-serif text-lg">编目</div>
        </div>
        <nav className="mt-8 space-y-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                  on ? "bg-white/10 text-sand-50" : "text-white/45 hover:text-sand-50"
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2 px-3 text-sm">
          <Link to="/app" className="block text-white/40 hover:text-sand-50">
            我的工作台
          </Link>
          <button onClick={logout} className="text-white/40 hover:text-sand-50">
            退出
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-8 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl">{tabs.find((t) => t.id === tab)?.label}</h1>
            <p className="text-xs text-white/35">{session.operator?.name || session.operator?.phone}</p>
          </div>
          <span className="flex items-center gap-2 font-mono text-xs text-white/40">
            <span className={`h-1.5 w-1.5 rounded-full ${health?.ok ? "bg-emerald-400" : "bg-white/20"}`} />
            {health?.ok ? "healthy" : "health unknown"}
          </span>
        </div>
        {err && <Banner kind="err">{err}</Banner>}
        {note && <div className="mb-4"><Banner kind="ok">{note}</Banner></div>}

        {tab === "overview" && ov && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile k="用户" v={ov.operators} />
            <Tile k="上游钥匙" v={`${ov.active_keys} 活 / ${ov.disabled_keys} 停`} />
            <Tile k="池 / 渠" v={`${ov.pools} / ${ov.channels}`} />
            <Tile k="虚拟钥匙" v={ov.virtual_keys} />
          </div>
        )}
        {tab === "users" && (
          <UsersTab users={users} onDone={async (m) => { await reload(); flash(m); }} onErr={fail} />
        )}
        {tab === "providers" && (
          <ProvidersTab rows={providers} onDone={async (m) => { await reload(); flash(m); }} onErr={fail} />
        )}
        {tab === "pools" && (
          <PoolsTab rows={pools} onDone={async (m) => { await reload(); flash(m); }} onErr={fail} />
        )}
        {tab === "channels" && (
          <ChannelsTab
            rows={channels}
            pools={pools}
            providers={providers}
            onDone={async (m) => { await reload(); flash(m); }}
            onErr={fail}
          />
        )}
        {tab === "keys" && (
          <VKsTab
            rows={vks}
            pools={pools}
            users={users}
            onDone={async (m) => { await reload(); flash(m); }}
            onErr={fail}
          />
        )}
      </main>
    </div>
  );
}

function Tile({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-ink-900/70 p-5">
      <div className="text-xs text-white/40">{k}</div>
      <div className="mt-2 font-serif text-3xl">{v}</div>
    </div>
  );
}

function UsersTab({
  users,
  onDone,
  onErr,
}: {
  users: Operator[];
  onDone: (m: string) => Promise<void>;
  onErr: (e: unknown) => void;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("developer");
  const [password, setPassword] = useState("");

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createUser({ phone, name, role, password });
      setPhone("");
      setName("");
      setPassword("");
      await onDone("用户已创建");
    } catch (err) {
      onErr(err);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="grid gap-3 rounded-2xl border border-white/[0.06] bg-ink-900/60 p-5 md:grid-cols-5">
        <In p="手机号" v={phone} set={setPhone} />
        <In p="姓名" v={name} set={setName} />
        <select
          className="rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="developer">开发者</option>
          <option value="admin">管理员</option>
        </select>
        <In p="初始密码" v={password} set={setPassword} type="password" />
        <button className="rounded-lg bg-ember-400 text-sm font-medium text-ink-950">新建用户</button>
      </form>
      <Table
        cols={["姓名", "手机", "角色", "状态", ""]}
        rows={users.map((u) => [
          u.name || "—",
          u.phone,
          u.role === "admin" ? "管理员" : "开发者",
          <Status key="s" s={u.status} />,
          <button
            key="a"
            className="text-xs text-white/40 hover:text-sand-50"
            onClick={async () => {
              try {
                await api.patchUser(u.id, { status: u.status === "active" ? "disabled" : "active" });
                await onDone(u.status === "active" ? "已停用" : "已启用");
              } catch (e) {
                onErr(e);
              }
            }}
          >
            {u.status === "active" ? "停用" : "启用"}
          </button>,
        ])}
      />
    </div>
  );
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
  const [code, setCode] = useState("deepseek");
  const [secret, setSecret] = useState("");
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createProviderKey({ provider_code: code, secret });
      setSecret("");
      await onDone("官方 Key 已加密入库");
    } catch (err) {
      onErr(err);
    }
  }
  return (
    <div className="space-y-6">
      <form onSubmit={create} className="grid gap-3 rounded-2xl border border-white/[0.06] bg-ink-900/60 p-5 md:grid-cols-3">
        <In p="厂商代码" v={code} set={setCode} />
        <In p="官方 Secret（只写一次）" v={secret} set={setSecret} type="password" />
        <button className="rounded-lg bg-ember-400 text-sm font-medium text-ink-950">入库</button>
      </form>
      <Table
        cols={["ID", "厂商", "状态", ""]}
        rows={rows.map((r) => [
          r.id,
          r.provider_code,
          <Status key="s" s={r.status} />,
          <button
            key="a"
            className="text-xs text-white/40 hover:text-sand-50"
            onClick={async () => {
              try {
                await api.patchProviderKey(r.id, { status: r.status === "active" ? "disabled" : "active" });
                await onDone("已更新");
              } catch (e) {
                onErr(e);
              }
            }}
          >
            {r.status === "active" ? "停用" : "启用"}
          </button>,
        ])}
      />
    </div>
  );
}

function PoolsTab({
  rows,
  onDone,
  onErr,
}: {
  rows: Pool[];
  onDone: (m: string) => Promise<void>;
  onErr: (e: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("standard");
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createPool({ name, group_name: group });
      setName("");
      await onDone("池已创建");
    } catch (err) {
      onErr(err);
    }
  }
  return (
    <div className="space-y-6">
      <form onSubmit={create} className="grid gap-3 rounded-2xl border border-white/[0.06] bg-ink-900/60 p-5 md:grid-cols-3">
        <In p="名称" v={name} set={setName} />
        <select className="rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="premium">premium</option>
          <option value="standard">standard</option>
          <option value="bulk">bulk</option>
        </select>
        <button className="rounded-lg bg-ember-400 text-sm font-medium text-ink-950">新建池</button>
      </form>
      <Table cols={["ID", "名称", "分组"]} rows={rows.map((r) => [r.id, r.name, r.group_name])} />
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
  rows: Channel[];
  pools: Pool[];
  providers: ProviderKey[];
  onDone: (m: string) => Promise<void>;
  onErr: (e: unknown) => void;
}) {
  const [poolID, setPoolID] = useState(pools[0]?.id ?? 0);
  const [pk, setPk] = useState(providers[0]?.id ?? 0);
  const [protocol, setProtocol] = useState("openai_chat");
  const [base, setBase] = useState("https://api.deepseek.com");
  useEffect(() => {
    if (pools[0] && !poolID) setPoolID(pools[0].id);
    if (providers[0] && !pk) setPk(providers[0].id);
  }, [pools, providers, poolID, pk]);
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createChannel({ pool_id: Number(poolID), provider_key_id: Number(pk), protocol, base_url: base });
      await onDone("渠已铺上");
    } catch (err) {
      onErr(err);
    }
  }
  return (
    <div className="space-y-6">
      <form onSubmit={create} className="grid gap-3 rounded-2xl border border-white/[0.06] bg-ink-900/60 p-5 md:grid-cols-5">
        <select className="rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm" value={poolID} onChange={(e) => setPoolID(Number(e.target.value))}>
          {pools.map((p) => (
            <option key={p.id} value={p.id}>池 {p.name}</option>
          ))}
        </select>
        <select className="rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm" value={pk} onChange={(e) => setPk(Number(e.target.value))}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>Key #{p.id} {p.provider_code}</option>
          ))}
        </select>
        <select className="rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
          <option value="openai_chat">OpenAI</option>
          <option value="anthropic_messages">Anthropic</option>
        </select>
        <In p="上游 Base URL" v={base} set={setBase} />
        <button className="rounded-lg bg-ember-400 text-sm font-medium text-ink-950">铺渠</button>
      </form>
      <Table
        cols={["ID", "池", "Key", "协议", "上游", "状态", ""]}
        rows={rows.map((r) => [
          r.id,
          r.pool_id,
          r.provider_key_id,
          r.protocol,
          r.base_url,
          <Status key="s" s={r.status} />,
          <button
            key="a"
            className="text-xs text-white/40 hover:text-sand-50"
            onClick={async () => {
              try {
                await api.patchChannel(r.id, { status: r.status === "active" ? "disabled" : "active" });
                await onDone("已更新");
              } catch (e) {
                onErr(e);
              }
            }}
          >
            {r.status === "active" ? "停用" : "启用"}
          </button>,
        ])}
      />
    </div>
  );
}

function VKsTab({
  rows,
  pools,
  users,
  onDone,
  onErr,
}: {
  rows: VirtualKey[];
  pools: Pool[];
  users: Operator[];
  onDone: (m: string) => Promise<void>;
  onErr: (e: unknown) => void;
}) {
  const [poolID, setPoolID] = useState(pools[0]?.id ?? 0);
  const [owner, setOwner] = useState(0);
  const [once, setOnce] = useState("");
  useEffect(() => {
    if (pools[0] && !poolID) setPoolID(pools[0].id);
  }, [pools, poolID]);
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const vk = await api.createVK({ pool_id: Number(poolID), owner_id: Number(owner) });
      setOnce(vk.secret ?? "");
      await onDone("VK 已生成，明文只这一次");
    } catch (err) {
      onErr(err);
    }
  }
  return (
    <div className="space-y-6">
      <form onSubmit={create} className="grid gap-3 rounded-2xl border border-white/[0.06] bg-ink-900/60 p-5 md:grid-cols-3">
        <select className="rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm" value={poolID} onChange={(e) => setPoolID(Number(e.target.value))}>
          {pools.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select className="rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm" value={owner} onChange={(e) => setOwner(Number(e.target.value))}>
          <option value={0}>不指定持有人</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name || u.phone}</option>
          ))}
        </select>
        <button className="rounded-lg bg-ember-400 text-sm font-medium text-ink-950">发放 VK</button>
      </form>
      {once && (
        <div className="rounded-xl border border-ember-400/30 bg-ember-400/10 px-4 py-3 font-mono text-sm text-ember-300">
          请立刻复制：{once}
        </div>
      )}
      <Table
        cols={["ID", "掩码", "池", "持有人", "状态", ""]}
        rows={rows.map((r) => [
          r.id,
          r.key_masked,
          r.pool_id,
          r.owner_id || "—",
          <Status key="s" s={r.status} />,
          <button
            key="a"
            className="text-xs text-white/40 hover:text-sand-50"
            onClick={async () => {
              try {
                await api.patchVK(r.id, { status: r.status === "active" ? "disabled" : "active" });
                await onDone("已更新");
              } catch (e) {
                onErr(e);
              }
            }}
          >
            {r.status === "active" ? "停用" : "启用"}
          </button>,
        ])}
      />
    </div>
  );
}

function In({ p, v, set, type = "text" }: { p: string; v: string; set: (s: string) => void; type?: string }) {
  return (
    <input
      className="rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus:ring-2 focus:ring-ember-400/40"
      placeholder={p}
      value={v}
      type={type}
      onChange={(e) => set(e.target.value)}
    />
  );
}

function Table({ cols, rows }: { cols: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
      <table className="w-full text-left text-sm">
        <thead className="bg-white/[0.03] text-xs text-white/40">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-4 py-2.5 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/[0.05]">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-2.5 align-middle">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-white/30">暂无数据</p>}
    </div>
  );
}
