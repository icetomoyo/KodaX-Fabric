import { useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateModel, useDisableModel, useModels, useProviders } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";
import type { Model } from "@/types/api";

export default function ModelsPage() {
  const list = useModels();
  const providers = useProviders();
  const create = useCreateModel();
  const disable = useDisableModel();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", family: "openai", provider: "" });

  const columns: ColumnDef<Model>[] = [
    { accessorKey: "name", header: "Model" },
    { accessorKey: "family", header: "家族" },
    { accessorKey: "provider", header: "Provider" },
    {
      accessorKey: "disabled",
      header: "状态",
      cell: ({ getValue }) => (getValue<boolean>() ? "已停用" : "可用"),
    },
    {
      id: "actions",
      cell: ({ row }) =>
        row.original.disabled ? null : (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await disable.mutateAsync(row.original.name);
                toast.success("已停用");
              } catch (e) {
                toast.error(errMsg(e));
              }
            }}
          >
            停用
          </Button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Model 映射"
        description="线路上的 model 字符串唯一对应一对 Provider。不能别名、不能双 Key。"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>映射 Model</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>映射 Model</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await create.mutateAsync(form);
                    toast.success("已映射");
                    setOpen(false);
                  } catch (err) {
                    toast.error(errMsg(err));
                  }
                }}
              >
                <Input placeholder="model 字符串" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <Input placeholder="openai / anthropic" value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })} />
                <Input
                  placeholder="Provider 名称"
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                  list="providers"
                />
                <datalist id="providers">
                  {(providers.data ?? []).map((p) => (
                    <option key={p.name} value={p.name} />
                  ))}
                </datalist>
                <Button type="submit" disabled={create.isPending}>
                  保存
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <DataTable columns={columns} data={list.data ?? []} isLoading={list.isPending} />
    </div>
  );
}
