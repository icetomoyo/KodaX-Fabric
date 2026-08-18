import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { homeFor } from "@/lib/consoles";
import { errMsg } from "@/lib/error";

const schema = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});
type Values = z.infer<typeof schema>;

export function LoginPage() {
  const { status, login, operator } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [err, setErr] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: "admin", password: "" },
  });

  if (status === "authed") {
    const from = (loc.state as { from?: string } | null)?.from;
    const dest = from && from !== "/" ? from : homeFor(operator?.role);
    return <Navigate to={dest} replace />;
  }

  async function onSubmit(v: Values) {
    setErr("");
    try {
      const op = await login(v.username, v.password);
      nav(homeFor(op.role), { replace: true });
    } catch (e) {
      setErr(errMsg(e, "无法连接网关"));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground">
            K
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">登录 KodaX Fabric</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Token Hub 管理控制台</p>
        </div>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-8 rounded-lg border border-border bg-card p-6 shadow-card"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="username">用户名</Label>
            <Input id="username" autoComplete="username" {...register("username")} />
            {errors.username ? <p className="text-xs text-destructive">{errors.username.message}</p> : null}
          </div>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="password">密码</Label>
            <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
            {errors.password ? <p className="text-xs text-destructive">{errors.password.message}</p> : null}
          </div>
          {err ? <p className="mt-3 text-sm text-destructive">{err}</p> : null}
          <Button type="submit" className="mt-6 w-full" disabled={isSubmitting}>
            {isSubmitting ? "验证中…" : "登录"}
          </Button>
        </form>
      </div>
    </div>
  );
}
