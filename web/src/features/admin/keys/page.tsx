import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { useApproveVK, usePatchVK, useVirtualKeys } from "@/lib/query/hooks";
import { useAuth } from "@/lib/auth";
import { isOrgAdmin, isTeamAdmin } from "@/lib/labels";
import { errMsg } from "@/lib/error";
import type { VirtualKey } from "@/types/api";
import { vkColumns } from "./columns";
import { ApplyKeyDialog } from "./apply-dialog";
import { CreateKeyDialog } from "./create-dialog";

export default function KeysPage() {
  const { operator } = useAuth();
  const staff = isOrgAdmin(operator?.role) || isTeamAdmin(operator?.role);
  const vks = useVirtualKeys();
  const patch = usePatchVK();
  const approve = useApproveVK();

  const onToggle = useCallback(
    async (k: VirtualKey) => {
      const next = k.status === "active" ? "disabled" : "active";
      try {
        await patch.mutateAsync({ id: k.id, status: next });
        toast.success("已更新");
      } catch (e) {
        toast.error(errMsg(e));
      }
    },
    [patch],
  );

  const onApprove = useCallback(
    async (k: VirtualKey) => {
      try {
        const row = await approve.mutateAsync(k.id);
        const secret = (row as VirtualKey & { secret?: string }).secret;
        toast.success(secret ? `已批准，请立刻复制：${secret}` : "已批准");
      } catch (e) {
        toast.error(errMsg(e));
      }
    },
    [approve],
  );

  const columns = useMemo(
    () => vkColumns(onToggle, patch.isPending, staff ? onApprove : undefined, approve.isPending),
    [onToggle, patch.isPending, staff, onApprove, approve.isPending],
  );

  return (
    <div>
      <PageHeader
        title="虚拟钥匙"
        description="库里只存哈希与前缀，明文只在发放或批准时出现一次。"
        actions={staff ? <CreateKeyDialog /> : <ApplyKeyDialog />}
      />
      <DataTable
        columns={columns}
        data={vks.data ?? []}
        isLoading={vks.isPending}
        searchPlaceholder="搜索掩码…"
      />
    </div>
  );
}
