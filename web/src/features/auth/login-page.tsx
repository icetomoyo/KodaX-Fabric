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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground">
            K
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
            登录 KodaX Fabric
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">统一密钥网关控制台</p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-8 rounded-lg border border-border bg-card p-6 shadow-card"
          noValidate
        >
          <div className="space-y-1.5">
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
        </form>

        <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
          管理员进入控制台，开发者进入自己的工作台。
        </p>
      </div>
    </div>
  );
}
