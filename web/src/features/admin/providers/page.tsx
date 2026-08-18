import { useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateProvider, useDisableProvider, useProviders } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";
import type { Provider } from "@/types/api";

export default function ProvidersPage() {
  const list = useProviders();
  const create = useCreateProvider();
  const disable = useDisableProvider();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", family: "openai", base_url: "https://api.deepseek.com", api_key: "" });

  const columns: ColumnDef<Provider>[] = [
    { accessorKey: "name", header: "名称" },
    { accessorKey: "family", header: "协议家族" },
    { accessorKey: "base_url", header: "Base URL" },
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
        title="上游 Provider"
        description="官方 Key 只写一次，密文入库，这里不回显。"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>登记 Provider</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>登记 Provider</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await create.mutateAsync(form);
                    toast.success("已登记");
                    setForm({ ...form, api_key: "" });
                    setOpen(false);
                  } catch (err) {
                    toast.error(errMsg(err));
                  }
                }}
              >
                <Input placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <Input placeholder="openai / anthropic" value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })} />
                <Input placeholder="base_url" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
                <Input type="password" placeholder="Provider Key" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
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
