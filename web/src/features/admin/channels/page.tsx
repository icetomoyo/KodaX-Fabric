import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { useChannels, usePatchChannel } from "@/lib/query/hooks";
import { errMsg } from "@/lib/error";
import type { Channel } from "@/types/api";
import { channelColumns } from "./columns";
import { CreateChannelDialog } from "./create-dialog";

export default function ChannelsPage() {
  const channels = useChannels();
  const patch = usePatchChannel();

  const onToggle = useCallback(
    async (c: Channel) => {
      const next = c.status === "active" ? "disabled" : "active";
      try {
        await patch.mutateAsync({ id: c.id, status: next });
        toast.success("已更新");
      } catch (e) {
        toast.error(errMsg(e));
      }
    },
    [patch],
  );

  const columns = useMemo(
    () => channelColumns(onToggle, patch.isPending),
    [onToggle, patch.isPending],
  );

  return (
    <div>
      <PageHeader title="渠" actions={<CreateChannelDialog />} />
      <DataTable
        columns={columns}
        data={channels.data ?? []}
        isLoading={channels.isPending}
        searchPlaceholder="搜索上游…"
      />
    </div>
  );
}
