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
import { useCreateChannel, usePools, useProviderKeys } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";

const schema = z.object({
  pool_id: z.string().min(1, "请选择池"),
  provider_key_id: z.string().min(1, "请选择上游钥匙"),
  protocol: z.enum(["openai_chat", "anthropic_messages"]),
  base_url: z.string().trim().url("请输入合法的 Base URL"),
});
type Values = z.infer<typeof schema>;

export function CreateChannelDialog() {
  const [open, setOpen] = useState(false);
  const pools = usePools();
  const providers = useProviderKeys();
  const create = useCreateChannel();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      pool_id: "",
      provider_key_id: "",
      protocol: "openai_chat",
      base_url: "https://api.deepseek.com",
    },
  });

  async function onSubmit(v: Values) {
    try {
      await create.mutateAsync({
        pool_id: Number(v.pool_id),
        provider_key_id: Number(v.provider_key_id),
        protocol: v.protocol,
        base_url: v.base_url,
      });
      toast.success("渠已铺上");
      form.reset();
      setOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  const noPools = (pools.data ?? []).length === 0;
  const noKeys = (providers.data ?? []).length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" /> 铺渠
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>铺渠</DialogTitle>
        </DialogHeader>
        {noPools || noKeys ? (
          <p className="text-sm text-muted-foreground">
            需要先{noPools ? "创建渠道池" : ""}
            {noPools && noKeys ? "并" : ""}
            {noKeys ? "入库上游钥匙" : ""}，才能铺渠。
          </p>
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
                name="provider_key_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>上游钥匙</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择 Key" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(providers.data ?? []).map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            #{p.id} {p.provider_code}
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
                name="protocol"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>协议</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="openai_chat">OpenAI</SelectItem>
                        <SelectItem value="anthropic_messages">Anthropic</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="base_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>上游 Base URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://api.deepseek.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={create.isPending}>
                {create.isPending ? "铺渠中…" : "铺渠"}
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
