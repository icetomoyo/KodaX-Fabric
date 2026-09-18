import { db } from "../db/client.js";
import { opsAuditLogs } from "../db/schema/index.js";

export function formatOpsAuditTargetLabel(
  parts: Array<string | null | undefined>,
  fallback: string,
): string {
  const label = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return label || fallback;
}

export async function writeOpsAudit(input: {
  actorEmployeeId?: number | null;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: unknown;
  ip?: string;
}) {
  await db.insert(opsAuditLogs).values({
    actorEmployeeId: input.actorEmployeeId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    detail: input.detail as Record<string, unknown> | undefined,
    ip: input.ip,
  });
}
