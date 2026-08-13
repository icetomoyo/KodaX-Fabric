import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { usePatchUser, useUsers } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";
import type { Operator } from "@/types/api";
import { userColumns } from "./columns";
import { CreateUserDialog } from "./create-dialog";

export default function UsersPage() {
  const users = useUsers();
  const patch = usePatchUser();

  const onToggle = useCallback(
    async (u: Operator) => {
      const next = u.status === "active" ? "disabled" : "active";
      try {
        await patch.mutateAsync({ id: u.id, status: next });
        toast.success(next === "active" ? "已启用" : "已停用");
      } catch (e) {
        toast.error(errMsg(e));
      }
    },
    [patch],
  );

  const columns = useMemo(
    () => userColumns(onToggle, patch.isPending),
    [onToggle, patch.isPending],
  );

  return (
    <div>
      <PageHeader title="用户" actions={<CreateUserDialog />} />
      <DataTable
        columns={columns}
        data={users.data ?? []}
        isLoading={users.isPending}
        searchPlaceholder="搜索姓名 / 手机…"
      />
    </div>
  );
}
