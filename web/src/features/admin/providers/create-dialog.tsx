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
import { useCreateProviderKey, useTeams } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";

const schema = z.object({
  provider_code: z.string().trim().min(1, "请输入厂商代码"),
  secret: z.string().min(1, "请输入官方 Secret"),
  team_id: z.string(),
});
type Values = z.infer<typeof schema>;

export function CreateProviderDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateProviderKey();
  const teams = useTeams();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { provider_code: "deepseek", secret: "", team_id: "0" },
  });

  async function onSubmit(v: Values) {
    try {
      await create.mutateAsync({
        provider_code: v.provider_code,
        secret: v.secret,
        team_id: Number(v.team_id) || 0,
      });
      toast.success("官方 Key 已加密入库");
      form.reset({ provider_code: v.provider_code, secret: "" });
      setOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" /> 入库上游钥匙
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>入库上游钥匙</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="provider_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>厂商代码</FormLabel>
                  <FormControl>
                    <Input placeholder="deepseek / openai / anthropic" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="secret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>官方 Secret（只写一次，密文入库）</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="sk-…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="team_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>团队</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="无归属" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="0">无归属</SelectItem>
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
            <Button type="submit" className="w-full" disabled={create.isPending}>
              {create.isPending ? "入库中…" : "入库"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
