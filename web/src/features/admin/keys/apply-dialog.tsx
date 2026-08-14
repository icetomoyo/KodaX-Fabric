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
import { useApplyVK, usePools, useProjects } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";

const schema = z.object({
  pool_id: z.string().min(1, "请选择池"),
  project_id: z.string().min(1, "请选择项目"),
});
type Values = z.infer<typeof schema>;

export function ApplyKeyDialog() {
  const [open, setOpen] = useState(false);
  const pools = usePools();
  const projects = useProjects();
  const apply = useApplyVK();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { pool_id: "", project_id: "" },
  });

  async function onSubmit(v: Values) {
    try {
      await apply.mutateAsync({
        pool_id: Number(v.pool_id),
        project_id: Number(v.project_id),
      });
      toast.success("已提交申请，等待审批");
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
          <Plus className="mr-1 h-4 w-4" /> 申请钥匙
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>申请虚拟钥匙</DialogTitle>
          <DialogDescription>批准前没有明文，也不能调网关。</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
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
            <Button type="submit" className="w-full" disabled={apply.isPending}>
              {apply.isPending ? "提交中…" : "提交申请"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
