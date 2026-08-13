import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { probeAdmin, setToken } from "@/lib/api";

export function LoginPage() {
  const nav = useNavigate();
  const [token, setTok] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const ok = await probeAdmin(token.trim());
      if (!ok) {
        setErr("令牌无效，或网关未配置 ADMIN_TOKEN");
        return;
      }
      setToken(token.trim());
      nav("/admin");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "无法连接网关");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.28em] text-ember-400/80">Token Hub</p>
        <h1 className="text-3xl font-semibold tracking-tight">管理后台</h1>
        <p className="mt-2 text-sm text-white/45">用网关的 ADMIN_TOKEN 进入。只编目钥匙、池、渠，不做 17 屏控制台。</p>
        <Card className="mt-8 p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="tok">Admin token</Label>
              <Input
                id="tok"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setTok(e.target.value)}
                placeholder="X-Admin-Token"
              />
            </div>
            {err && <p className="text-sm text-red-300">{err}</p>}
            <Button type="submit" disabled={busy || !token.trim()} className="w-full">
              {busy ? "验证中…" : "进入"}
            </Button>
          </form>
        </Card>
        <p className="mt-6 font-mono text-[11px] text-white/30">本机 compose 默认 dev-local-admin-token · Origin :3000</p>
      </div>
    </div>
  );
}
