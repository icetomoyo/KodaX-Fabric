import { useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateProject, useProjects } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";
import type { Project } from "@/types/api";

const columns: ColumnDef<Project>[] = [{ accessorKey: "name", header: "名称" }];

export default function ProjectsPage() {
  const list = useProjects();
  const create = useCreateProject();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  return (
    <div>
      <PageHeader
        title="项目"
        description="独立成本桶。创建后不能改名、不能删除。"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>新建 Project</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建 Project</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await create.mutateAsync(name);
                    toast.success("已创建");
                    setName("");
                    setOpen(false);
                  } catch (err) {
                    toast.error(errMsg(err));
                  }
                }}
              >
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称" />
                <Button type="submit" disabled={create.isPending}>
                  创建
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
