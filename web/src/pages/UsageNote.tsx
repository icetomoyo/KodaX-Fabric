export function UsageNote({ origin }: { origin: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-sm leading-6">
      <p className="font-medium">接入说明</p>
      <p>
        Cursor / Claude Code 的 Base URL 填网关 Origin：<code className="rounded bg-muted px-1">{origin}</code>
        （不要带 <code>/v1</code>）。
      </p>
      <p>
        同一把 <code className="rounded bg-muted px-1">fab-</code> 虚拟钥匙可用于{" "}
        <code className="rounded bg-muted px-1">POST /v1/chat/completions</code> 与{" "}
        <code className="rounded bg-muted px-1">POST /v1/messages</code>。
      </p>
    </div>
  );
}
