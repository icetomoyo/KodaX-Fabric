import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Session } from "@/App";

export function LoginPage({
  session,
  setSession,
}: {
  session: Session;
  setSession: (s: Session) => void;
}) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (session.operator) {
    return <Navigate to={session.operator.role === "admin" ? "/admin" : "/app"} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api.login(phone.trim(), password);
      setSession({ operator: r.operator, ready: true });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "无法连接网关");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <aside className="relative hidden overflow-hidden border-r border-white/[0.06] px-14 py-16 lg:flex lg:flex-col">
        <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-ember-400/10 blur-3xl" />
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-ember-400/90">KodaX Fabric</p>
        <h1 className="mt-8 font-serif text-5xl leading-[1.1] tracking-tight">
          一把虚拟钥匙，
          <br />
          管住所有上游。
        </h1>
        <p className="mt-6 max-w-md text-sm leading-7 text-white/50">
          Token Hub 把官方 Key 锁在网关里。员工只拿 <span className="font-mono text-ember-300">fab-</span>{" "}
          钥匙；管理员在这里发卡、停用、看渠还活不活。
        </p>
        <div className="mt-auto grid grid-cols-3 gap-4 text-xs text-white/40">
          <Stat k="零转换" v="双端点透传" />
          <Stat k="钥匙柜" v="加密 · 轮转 · 停用" />
          <Stat k="调用方" v="永远看不到官方 Key" />
        </div>
      </aside>

      <main className="flex items-center justify-center px-6 py-16">
        <form onSubmit={onSubmit} className="w-full max-w-sm">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-ember-400/80">Sign in</p>
          <h2 className="mt-3 font-serif text-3xl">进入控制台</h2>
          <p className="mt-2 text-sm text-white/40">管理员进编目，开发者进自己的工作台。</p>

          <label className="mt-8 block text-xs text-white/45">手机号</label>
          <input
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2.5 text-sm outline-none ring-ember-400/40 placeholder:text-white/25 focus:ring-2"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="username"
            placeholder="186****3416"
          />
          <label className="mt-4 block text-xs text-white/45">密码</label>
          <input
            type="password"
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2.5 text-sm outline-none ring-ember-400/40 placeholder:text-white/25 focus:ring-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
          />
          {err && <p className="mt-3 text-sm text-red-300">{err}</p>}
          <button
            type="submit"
            disabled={busy || !phone.trim() || !password}
            className="mt-6 w-full rounded-lg bg-ember-400 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-ember-300 disabled:opacity-40"
          >
            {busy ? "验证中…" : "登录"}
          </button>
          <p className="mt-6 font-mono text-[11px] leading-5 text-white/28">
            本机默认管理员 18612243416 / Hz@123456
            <br />
            开发者 13800138000 / Dev@123456
          </p>
        </form>
      </main>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-ember-400/70">{k}</div>
      <div className="mt-1 text-sand-50">{v}</div>
    </div>
  );
}
