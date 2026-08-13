import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { errMsg } from "@/lib/error";

const schema = z.object({
  phone: z.string().trim().min(1, "请输入手机号"),
  password: z.string().min(1, "请输入密码"),
});
type Values = z.infer<typeof schema>;

export function LoginPage() {
  const { status, operator, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [err, setErr] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { phone: "", password: "" },
  });

  if (status === "authed") {
    const from = (loc.state as { from?: string } | null)?.from;
    const dest = from && from !== "/" ? from : operator?.role === "admin" ? "/admin" : "/app";
    return <Navigate to={dest} replace />;
  }

  async function onSubmit(v: Values) {
    setErr("");
    try {
      const op = await login(v.phone, v.password);
      nav(op.role === "admin" ? "/admin" : "/app", { replace: true });
    } catch (e) {
      setErr(errMsg(e, "无法连接网关"));
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <aside className="relative hidden overflow-hidden border-r border-border px-14 py-16 lg:flex lg:flex-col">
        <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-ember-400/10 blur-3xl" />
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-ember-400/90">
          KodaX-Fabric
        </p>
        <h1 className="mt-8 font-serif text-5xl leading-[1.1] tracking-tight">
          一把虚拟钥匙，
          <br />
          管住所有上游。
        </h1>
        <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">
          KodaX-Fabric 把官方 Key 锁在网关里。员工只拿{" "}
          <span className="font-mono text-ember-300">fab-</span>{" "}
          钥匙；管理员在这里发卡、停用、看渠还活不活。
        </p>
        <div className="mt-auto grid grid-cols-3 gap-4 text-xs text-muted-foreground">
          <Stat k="零转换" v="双端点透传" />
          <Stat k="钥匙柜" v="加密 · 轮转 · 停用" />
          <Stat k="调用方" v="永远看不到官方 Key" />
        </div>
      </aside>

      <main className="flex items-center justify-center px-6 py-16">
        <form onSubmit={handleSubmit(onSubmit)} className="w-full max-w-sm" noValidate>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-ember-400/80">
            Sign in
          </p>
          <h2 className="mt-3 font-serif text-3xl">进入控制台</h2>
          <p className="mt-2 text-sm text-muted-foreground">管理员进编目，开发者进自己的工作台。</p>

          <div className="mt-8 space-y-1.5">
            <Label htmlFor="phone">手机号</Label>
            <Input
              id="phone"
              autoComplete="username"
              placeholder="186****3416"
              {...register("phone")}
            />
            {errors.phone ? (
              <p className="text-xs text-destructive">{errors.phone.message}</p>
            ) : null}
          </div>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              {...register("password")}
            />
            {errors.password ? (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            ) : null}
          </div>

          {err ? <p className="mt-3 text-sm text-destructive">{err}</p> : null}
          <Button type="submit" className="mt-6 w-full" disabled={isSubmitting}>
            {isSubmitting ? "验证中…" : "登录"}
          </Button>
          <p className="mt-6 font-mono text-[11px] leading-5 text-muted-foreground/60">
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
    <div className="rounded-xl border border-border bg-card/40 px-3 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-ember-400/70">{k}</div>
      <div className="mt-1 text-foreground">{v}</div>
    </div>
  );
}
