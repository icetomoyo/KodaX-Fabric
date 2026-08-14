import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { errMsg } from "@/lib/error";
import { roleLabel } from "@/lib/labels";
import { usePatchMe } from "@/lib/query/hooks";

const schema = z.object({
  name: z.string().trim().max(100, "显示名过长"),
  password: z.string().min(8, "密码至少 8 位").or(z.literal("")),
});
type Values = z.infer<typeof schema>;

export default function ProfilePage() {
  const { operator } = useAuth();
  const patchMe = usePatchMe();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: operator?.name ?? "", password: "" },
  });

  useEffect(() => {
    reset({ name: operator?.name ?? "", password: "" });
  }, [operator?.name, reset]);

  async function onSave(v: Values) {
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

  return (
    <div>
      <PageHeader
        title="我的资料"
        description="改自己的显示名和登录密码。手机号和角色不能自己改。"
      />
      <Card className="max-w-xl">
        <CardContent className="p-6">
          <form onSubmit={handleSubmit(onSave)} className="grid gap-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="phone">手机号</Label>
              <Input id="phone" value={operator?.phone ?? ""} disabled readOnly />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">角色</Label>
              <Input id="role" value={roleLabel(operator?.role)} disabled readOnly />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">显示名</Label>
              <Input id="name" {...register("name")} />
              {errors.name ? (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">新密码（留空不改）</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register("password")}
              />
              {errors.password ? (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              ) : null}
            </div>
            <div>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "保存中…" : "保存"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
