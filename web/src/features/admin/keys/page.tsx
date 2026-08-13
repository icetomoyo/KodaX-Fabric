import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { usePatchVK, useVirtualKeys } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";
import type { VirtualKey } from "@/types/api";
import { vkColumns } from "./columns";
import { CreateKeyDialog } from "./create-dialog";

export default function KeysPage() {
  const vks = useVirtualKeys();
  const patch = usePatchVK();

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

  const columns = useMemo(() => vkColumns(onToggle, patch.isPending), [onToggle, patch.isPending]);

  return (
    <div>
      <PageHeader
        title="虚拟钥匙"
        description="库里只存哈希与前缀，明文只在发放时出现一次。"
        actions={<CreateKeyDialog />}
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
