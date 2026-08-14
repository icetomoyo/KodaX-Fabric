import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateUser, useTeams } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";
import { ROLES } from "@/lib/labels";

const schema = z
  .object({
    phone: z
      .string()
      .trim()
      .regex(/^1\d{10}$/, "请输入 11 位手机号"),
    name: z.string().trim().min(1, "请输入姓名").max(100),
    role: z.enum(["developer", "org_admin", "team_admin"]),
    team_id: z.string(),
    password: z.string().min(8, "密码至少 8 位"),
  })
  .superRefine((v, ctx) => {
    if (v.role === "team_admin" && (!v.team_id || v.team_id === "0")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "团队管理员必须挂队",
        path: ["team_id"],
      });
    }
  });
type Values = z.infer<typeof schema>;

export function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateUser();
  const teams = useTeams();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { phone: "", name: "", role: "developer", team_id: "0", password: "" },
  });
  const role = form.watch("role");

  async function onSubmit(v: Values) {
    try {
      await create.mutateAsync({
        phone: v.phone,
        name: v.name,
        role: v.role,
        password: v.password,
        team_id: Number(v.team_id) || 0,
      });
      toast.success("用户已创建");
      form.reset();
      setOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" /> 新建用户
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建用户</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>手机号</FormLabel>
                  <FormControl>
                    <Input placeholder="186****3416" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>姓名</FormLabel>
                  <FormControl>
                    <Input placeholder="张三" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>角色</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {role === "team_admin" ? (
              <FormField
                control={form.control}
                name="team_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>所属团队</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择团队" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="0">请选择团队</SelectItem>
                        {(teams.data ?? []).map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>初始密码</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="至少 8 位" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={create.isPending}>
              {create.isPending ? "创建中…" : "创建"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
