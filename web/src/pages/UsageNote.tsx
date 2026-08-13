import { CopyButton } from "@/components/CopyButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function UsageNote({ origin }: { origin: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>接入 Cursor / Claude Code</CardTitle>
        <CardDescription>只改 Base URL，模型协议不用换。同一把 fab- 钥匙两个端点都能用。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/70 px-3 py-2.5">
          <div>
            <p className="text-xs text-muted-foreground">Base URL（不要带 /v1）</p>
            <code className="text-[13px]">{origin || "—"}</code>
          </div>
          <CopyButton text={origin} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Cursor / OpenAI 兼容</p>
            <code className="mt-1 block text-[13px]">POST /v1/chat/completions</code>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Claude Code / Anthropic</p>
            <code className="mt-1 block text-[13px]">POST /v1/messages</code>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
