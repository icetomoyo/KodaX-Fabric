import { db } from "../db/client.js";
import { opsAuditLogs } from "../db/schema/index.js";

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
