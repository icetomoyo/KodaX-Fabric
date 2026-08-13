import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { usePools } from "@/lib/query/hooks";
import { poolColumns } from "./columns";
import { CreatePoolDialog } from "./create-dialog";

export default function PoolsPage() {
  const pools = usePools();
  return (
    <div>
      <PageHeader title="渠道池" actions={<CreatePoolDialog />} />
      <DataTable
        columns={poolColumns}
        data={pools.data ?? []}
        isLoading={pools.isPending}
        searchPlaceholder="搜索名称…"
      />
    </div>
  );
}
