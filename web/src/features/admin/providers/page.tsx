import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { usePatchProviderKey, useProviderKeys } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";
import type { ProviderKey } from "@/types/api";
import { providerColumns } from "./columns";
import { CreateProviderDialog } from "./create-dialog";

export default function ProvidersPage() {
  const keys = useProviderKeys();
  const patch = usePatchProviderKey();

  const onToggle = useCallback(
    async (k: ProviderKey) => {
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

  const columns = useMemo(
    () => providerColumns(onToggle, patch.isPending),
    [onToggle, patch.isPending],
  );

  return (
    <div>
      <PageHeader
        title="上游钥匙"
        description="官方 Key 只写一次，密文入库，这里不回显。"
        actions={<CreateProviderDialog />}
      />
      <DataTable
        columns={columns}
        data={keys.data ?? []}
        isLoading={keys.isPending}
        searchPlaceholder="搜索厂商…"
      />
    </div>
  );
}
