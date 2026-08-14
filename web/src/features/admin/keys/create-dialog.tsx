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
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CopyText } from "@/components/shared/copy-text";
import { useCreateVK, usePools, useProjects, useUsers } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";

const schema = z.object({
  pool_id: z.string().min(1, "请选择池"),
  owner_id: z.string(),
  project_id: z.string().min(1, "请选择项目"),
});
type Values = z.infer<typeof schema>;

export function CreateKeyDialog() {
  const [open, setOpen] = useState(false);
  const [once, setOnce] = useState("");
  const pools = usePools();
  const users = useUsers();
  const projects = useProjects();
  const create = useCreateVK();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { pool_id: "", owner_id: "0", project_id: "" },
  });

  function handleOpen(next: boolean) {
    setOpen(next);
    if (!next) setOnce("");
  }

  async function onSubmit(v: Values) {
    try {
      const vk = await create.mutateAsync({
        pool_id: Number(v.pool_id),
        owner_id: Number(v.owner_id) || undefined,
        project_id: Number(v.project_id),
      });
      setOnce(vk.secret ?? "");
      toast.success("VK 已生成，明文只这一次");
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  const noPools = (pools.data ?? []).length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" /> 发放 VK
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发放虚拟钥匙</DialogTitle>
          <DialogDescription>明文只在创建瞬间显示一次，请立刻复制。</DialogDescription>
        </DialogHeader>
        {once ? (
          <div className="rounded-md border border-brand-200 bg-brand-50 p-4">
            <p className="mb-2 text-xs font-medium text-brand-800">请立刻复制，关闭后不再出现：</p>
            <CopyText value={once} className="break-all font-mono text-sm text-foreground" />
            <Button variant="secondary" className="mt-4 w-full" onClick={() => handleOpen(false)}>
              我已保存
            </Button>
          </div>
        ) : noPools ? (
          <p className="text-sm text-muted-foreground">需要先创建渠道池，才能发放 VK。</p>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="pool_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>渠道池</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择池" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(pools.data ?? []).map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="owner_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>持有人</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="不指定" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="0">不指定持有人</SelectItem>
                        {(users.data ?? []).map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name || u.phone}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="project_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>项目</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择项目" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(projects.data ?? []).map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={create.isPending}>
                {create.isPending ? "生成中…" : "发放 VK"}
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
