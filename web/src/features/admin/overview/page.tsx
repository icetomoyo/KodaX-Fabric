import type { ReactNode } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOverview } from "@/lib/query/hooks";

export default function OverviewPage() {
  const ov = useOverview();
  return (
    <div>
      <PageHeader title="总览" />
      {ov.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : ov.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tile k="用户" v={ov.data.operators} />
          <Tile k="上游钥匙" v={`${ov.data.active_keys} 活 / ${ov.data.disabled_keys} 停`} />
          <Tile k="池 / 渠" v={`${ov.data.pools} / ${ov.data.channels}`} />
          <Tile k="虚拟钥匙" v={ov.data.virtual_keys} />
          <Tile k="团队 / 项目" v={`${ov.data.teams ?? 0} / ${ov.data.projects ?? 0}`} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">无法加载总览。</p>
      )}
    </div>
  );
}

function Tile({ k, v }: { k: string; v: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium text-muted-foreground">{k}</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{v}</div>
      </CardContent>
    </Card>
  );
}
