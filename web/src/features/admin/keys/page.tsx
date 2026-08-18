import { useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateVK, useDisableVK, useProjects, useVirtualKeys } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";
import type { VirtualKey } from "@/types/api";

export default function KeysPage() {
  const list = useVirtualKeys();
  const projects = useProjects();
  const create = useCreateVK();
  const disable = useDisableVK();
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState("demo");
  const [secret, setSecret] = useState("");

  const columns: ColumnDef<VirtualKey>[] = [
    { accessorKey: "hash", header: "Hash" },
    { accessorKey: "project", header: "Project" },
    {
      accessorKey: "disabled",
      header: "状态",
      cell: ({ getValue }) => (getValue<boolean>() ? "已停用" : "可用"),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) =>
        row.original.disabled ? null : (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await disable.mutateAsync(row.original.hash);
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
        title="虚拟钥匙"
        description="明文只在创建时出现一次，只存哈希。停用后立刻拒绝。"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>创建 VK</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>创建 Virtual Key</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    const vk = await create.mutateAsync(project);
                    setSecret(vk.plaintext || "");
                    toast.success("已创建，请立刻复制明文");
                  } catch (err) {
                    toast.error(errMsg(err));
                  }
                }}
              >
                <Input
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  placeholder="Project"
                  list="projects"
                />
                <datalist id="projects">
                  {(projects.data ?? []).map((p) => (
                    <option key={p.name} value={p.name} />
                  ))}
                </datalist>
                <Button type="submit" disabled={create.isPending}>
                  创建
                </Button>
                {secret ? (
                  <p className="break-all rounded-md bg-muted p-2 text-sm">
                    明文（只此一次）：{secret}
                  </p>
                ) : null}
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <DataTable columns={columns} data={list.data ?? []} isLoading={list.isPending} />
    </div>
  );
}
