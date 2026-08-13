import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyText } from "@/components/shared/copy-text";
import { StatusBadge } from "@/components/shared/status-badge";
import { useAuth } from "@/lib/auth";
import { useMyKeys, usePatchMe } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";

const profileSchema = z.object({
  name: z.string().trim().max(100, "显示名过长"),
  password: z.string().min(8, "密码至少 8 位").or(z.literal("")),
});
type ProfileValues = z.infer<typeof profileSchema>;

export default function UserPage() {
  const { operator, logout } = useAuth();
  const keys = useMyKeys();
  const patchMe = usePatchMe();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: operator?.name ?? "", password: "" },
  });

  async function onSave(v: ProfileValues) {
    try {
      const body: { name?: string; password?: string } = { name: v.name };
      if (v.password) body.password = v.password;
      await patchMe.mutateAsync(body);
      reset({ name: v.name, password: "" });
      toast.success("资料已更新");
    } catch (e) {
      toast.error(errMsg(e, "保存失败"));
    }
  }

  const origin = window.location.origin;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400/80">
              Token Hub
            </p>
            <h1 className="font-serif text-xl">工作台</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {operator?.role === "admin" ? (
              <Link
                to="/admin"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                管理后台
              </Link>
            ) : null}
            <button
              onClick={() => void logout()}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        <section>
          <p className="text-sm text-muted-foreground">你好</p>
          <h2 className="font-serif text-4xl tracking-tight">
            {operator?.name || operator?.phone}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            你只持有虚拟钥匙。公司官方 Key 不会出现在这个页面。
          </p>
        </section>

        <section>
          <h3 className="mb-3 text-sm text-muted-foreground">我的虚拟钥匙</h3>
          {keys.isPending ? (
            <div className="grid gap-3 md:grid-cols-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-28 w-full rounded-2xl" />
              ))}
            </div>
          ) : keys.data && keys.data.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {keys.data.map((k) => (
                <Card key={k.id} className="bg-card/80">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <CopyText value={k.key_masked} className="text-sm text-ember-300" />
                      <StatusBadge status={k.status} />
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      池 #{k.pool_id} · 仅显示前缀，明文只在发放时出现一次
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-sm text-muted-foreground">
              还没有发给你的钥匙。请联系管理员在后台创建一把 VK 并指定到你的账号。
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
            lines={[`Base URL  ${origin}`, "协议      Anthropic", "Header    x-api-key: fab-…"]}
          />
        </section>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">账号</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSave)} className="grid gap-4 md:grid-cols-2" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="name">显示名</Label>
                <Input id="name" {...register("name")} />
                {errors.name ? (
                  <p className="text-xs text-destructive">{errors.name.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">新密码（留空不改）</Label>
                <Input id="password" type="password" {...register("password")} />
                {errors.password ? (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                ) : null}
              </div>
              <div className="md:col-span-2">
                <Button type="submit" variant="secondary" disabled={isSubmitting}>
                  {isSubmitting ? "保存中…" : "保存"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Guide({ title, lines }: { title: string; lines: string[] }) {
  return (
    <Card className="bg-card/70">
      <CardContent className="p-5">
        <div className="text-sm">{title}</div>
        <pre className="mt-3 overflow-x-auto font-mono text-[12px] leading-6 text-muted-foreground">
          {lines.join("\n")}
        </pre>
      </CardContent>
    </Card>
  );
}
