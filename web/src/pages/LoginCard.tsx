import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";

const schema = z.object({
  phone: z.string().min(1, "必填"),
  password: z.string().min(1, "必填"),
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
    <div className="mx-auto w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">登录 Token Hub</h2>
      <Form {...form}>
        <form className="space-y-4" onSubmit={form.handleSubmit(onLogin)}>
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>手机</FormLabel>
                <FormControl>
                  <Input autoComplete="username" {...field} />
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
                  <FormLabel>姓名（注册用）</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
          <div className="flex gap-2">
            <Button type="submit">登录</Button>
            {allowRegister ? (
              <Button type="button" variant="outline" onClick={onRegister}>
                注册
              </Button>
            ) : null}
          </div>
        </form>
      </Form>
    </div>
  );
}
