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
import { useCreatePool } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";

const schema = z.object({
  name: z.string().trim().min(1, "请输入名称"),
  group_name: z.enum(["premium", "standard", "bulk"]),
});
type Values = z.infer<typeof schema>;

export function CreatePoolDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreatePool();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", group_name: "standard" },
  });

  async function onSubmit(v: Values) {
    try {
      await create.mutateAsync(v);
      toast.success("池已创建");
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
          <Plus className="mr-1 h-4 w-4" /> 新建池
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建渠道池</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>名称</FormLabel>
                  <FormControl>
                    <Input placeholder="default" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="group_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>分组</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="premium">premium</SelectItem>
                      <SelectItem value="standard">standard</SelectItem>
                      <SelectItem value="bulk">bulk</SelectItem>
                    </SelectContent>
                  </Select>
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
