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
import { useCreateTeam } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";
import type { Team } from "@/types/api";

const schema = z.object({ name: z.string().trim().min(1, "请输入名称") });
type Values = z.infer<typeof schema>;

export function CreateTeamDialog({ onCreated }: { onCreated?: (team: Team) => void }) {
  const [open, setOpen] = useState(false);
  const create = useCreateTeam();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  async function onSubmit(v: Values) {
    try {
      const team = await create.mutateAsync(v);
      toast.success("团队已创建");
      form.reset();
      setOpen(false);
      onCreated?.(team);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
          <Plus className="h-3.5 w-3.5" /> 新建
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建团队</DialogTitle>
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
                    <Input placeholder="研发 / 市场" {...field} />
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
