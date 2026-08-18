import { useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDeletePrice, useModels, usePrices, useUpsertPrice } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";
import type { Price } from "@/types/api";

export default function PricesPage() {
  const list = usePrices();
  const models = useModels();
  const upsert = useUpsertPrice();
  const del = useDeletePrice();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ model: "", input_cny: 1, output_cny: 2, cached_cny: 0.1 });

  const columns: ColumnDef<Price>[] = [
    { accessorKey: "model", header: "Model" },
    { accessorKey: "input_cny", header: "输入" },
    { accessorKey: "output_cny", header: "输出" },
    { accessorKey: "cached_cny", header: "缓存" },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await del.mutateAsync(row.original.model);
              toast.success("已删除价格行");
            } catch (e) {
              toast.error(errMsg(e));
            }
          }}
        >
          删除
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="价格表"
        description="每个 Model 一行 CNY 成本价。没有价格行不能调用。"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>写入价格</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>写入价格</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await upsert.mutateAsync(form);
                    toast.success("已保存");
                    setOpen(false);
                  } catch (err) {
                    toast.error(errMsg(err));
                  }
                }}
              >
                <Input
                  placeholder="Model"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  list="models"
                />
                <datalist id="models">
                  {(models.data ?? []).map((m) => (
                    <option key={m.name} value={m.name} />
                  ))}
                </datalist>
                <Input type="number" step="any" value={form.input_cny} onChange={(e) => setForm({ ...form, input_cny: Number(e.target.value) })} />
                <Input type="number" step="any" value={form.output_cny} onChange={(e) => setForm({ ...form, output_cny: Number(e.target.value) })} />
                <Input type="number" step="any" value={form.cached_cny} onChange={(e) => setForm({ ...form, cached_cny: Number(e.target.value) })} />
                <Button type="submit" disabled={upsert.isPending}>
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
