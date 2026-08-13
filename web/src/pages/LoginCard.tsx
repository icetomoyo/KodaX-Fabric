import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";

const schema = z.object({
  phone: z.string().min(1, "请输入手机号"),
  password: z.string().min(1, "请输入密码"),
  name: z.string().optional(),
});

type Values = z.infer<typeof schema>;

export function LoginCard({ allowRegister = true }: { allowRegister?: boolean }) {
  const { login, register } = useSession();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { phone: "", password: "", name: "" },
  });

  async function onLogin(v: Values) {
    try {
      await login(v.phone, v.password);
    } catch (e) {
      toast(e instanceof Error ? e.message : "登录失败", "destructive");
    }
  }

  async function onRegister() {
    const v = form.getValues();
    const parsed = schema.safeParse(v);
    if (!parsed.success) {
      parsed.error.issues.forEach((i) => form.setError(i.path[0] as keyof Values, { message: i.message }));
      return;
    }
    try {
      await register(v.phone, v.password, v.name || v.phone);
    } catch (e) {
      toast(e instanceof Error ? e.message : "注册失败", "destructive");
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-teal-500/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative z-10 flex flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-teal-300">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-sidebar-muted">KodaX</p>
              <p className="text-lg font-semibold leading-none">Token Hub</p>
            </div>
          </div>
          <div className="max-w-md space-y-4">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight">企业 Token 统一接入</h2>
            <p className="text-sm leading-7 text-sidebar-muted">
              调用方只拿一把 <span className="text-teal-300">fab-</span> 虚拟钥匙。Cursor 走 Chat Completions，Claude Code 走
              Messages，网关原样转发，不改协议。
            </p>
          </div>
          <p className="text-xs text-sidebar-muted">内部试用 · 0.1.0 · 正式版上线前过渡</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">KodaX</p>
            <h1 className="text-2xl font-semibold">Token Hub</h1>
          </div>
          <h2 className="text-xl font-semibold tracking-tight">登录控制台</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {allowRegister ? "已有账号直接登录；新同事可注册为开发者。" : "请使用管理员账号登录。"}
          </p>
          <Form {...form}>
            <form className="mt-6 space-y-4" onSubmit={form.handleSubmit(onLogin)}>
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>手机号</FormLabel>
                    <FormControl>
                      <Input autoComplete="username" placeholder="11 位手机号" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>密码</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {allowRegister ? (
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>姓名（仅注册）</FormLabel>
                      <FormControl>
                        <Input placeholder="选填" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
              <div className="flex gap-2 pt-1">
                <Button className="flex-1" type="submit">
                  登录
                </Button>
                {allowRegister ? (
                  <Button type="button" variant="outline" onClick={onRegister}>
                    注册开发者
                  </Button>
                ) : null}
              </div>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}
