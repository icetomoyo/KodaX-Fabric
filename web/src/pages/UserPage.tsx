import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Session } from "@/App";
import { api, type VirtualKey } from "@/lib/api";

export function UserPage({
  session,
  setSession,
}: {
  session: Session;
  setSession: (s: Session) => void;
}) {
  const nav = useNavigate();
  const op = session.operator!;
  const [keys, setKeys] = useState<VirtualKey[]>([]);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [name, setName] = useState(op.name);
  const [password, setPassword] = useState("");

  useEffect(() => {
    api
      .myKeys()
      .then((r) => setKeys(r.virtual_keys ?? []))
      .catch((e) => setErr(e instanceof Error ? e.message : "加载失败"));
  }, []);

  async function logout() {
    await api.logout().catch(() => {});
    setSession({ operator: null, ready: true });
    nav("/");
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const body: { name?: string; password?: string } = { name };
      if (password) body.password = password;
      const r = await api.patchMe(body);
      setSession({ operator: r.operator, ready: true });
      setPassword("");
      setNote("资料已更新");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "保存失败");
    }
  }

  const origin = window.location.origin;

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/[0.06] bg-ink-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400/80">Token Hub</p>
            <h1 className="font-serif text-xl">工作台</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {op.role === "admin" && (
              <Link to="/admin" className="text-white/45 hover:text-sand-50">
                管理后台
              </Link>
            )}
            <button onClick={logout} className="text-white/45 hover:text-sand-50">
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        {err && <Banner kind="err">{err}</Banner>}
        {note && <Banner kind="ok">{note}</Banner>}

        <section>
          <p className="text-sm text-white/40">你好</p>
          <h2 className="font-serif text-4xl tracking-tight">{op.name || op.phone}</h2>
          <p className="mt-2 text-sm text-white/45">
            你只持有虚拟钥匙。公司官方 Key 不会出现在这个页面。
          </p>
        </section>

        <section>
          <h3 className="mb-3 text-sm text-white/50">我的虚拟钥匙</h3>
          {keys.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-6 py-10 text-sm text-white/40">
              还没有发给你的钥匙。请联系管理员在后台创建一把 VK 并指定到你的账号。
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {keys.map((k) => (
                <article key={k.id} className="rounded-2xl border border-white/[0.06] bg-ink-900/80 p-5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-ember-300">{k.key_masked}</span>
                    <Status s={k.status} />
                  </div>
                  <p className="mt-3 text-xs text-white/35">池 #{k.pool_id} · 仅显示前缀，明文只在发放时出现一次</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Guide
            title="Cursor"
            lines={[
              `Base URL  ${origin}/v1`,
              "协议      OpenAI",
              "Header    Authorization: Bearer fab-…",
            ]}
          />
          <Guide
            title="Claude Code"
            lines={[
              `Base URL  ${origin}`,
              "协议      Anthropic",
              "Header    x-api-key: fab-…",
            ]}
          />
        </section>

        <section className="rounded-2xl border border-white/[0.06] bg-ink-900/70 p-6">
          <h3 className="text-sm text-white/50">账号</h3>
          <form onSubmit={saveProfile} className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="显示名" value={name} onChange={setName} />
            <Field label="新密码（留空不改）" value={password} onChange={setPassword} type="password" />
            <div className="md:col-span-2">
              <button className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15">保存</button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

function Guide({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-ink-900/70 p-5">
      <div className="text-sm">{title}</div>
      <pre className="mt-3 overflow-x-auto font-mono text-[12px] leading-6 text-white/55">{lines.join("\n")}</pre>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs text-white/40">
      {label}
      <input
        type={type}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-sand-50 outline-none focus:ring-2 focus:ring-ember-400/40"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function Status({ s }: { s: string }) {
  const on = s === "active";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${on ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-white/40"}`}>
      {on ? "启用" : "停用"}
    </span>
  );
}

export function Banner({ kind, children }: { kind: "err" | "ok"; children: string }) {
  return (
    <p className={`rounded-lg px-3 py-2 text-sm ${kind === "err" ? "bg-red-500/10 text-red-200" : "bg-emerald-500/10 text-emerald-200"}`}>
      {children}
    </p>
  );
}
