import { sql } from "../../db/client.js";

export type AuditBodyRecord = {
  requestId: string;
};

export type AuditRecord = {
  requestId: string;
  createdAt: Date;
  id: number;
};

/** Newest request wins; `id` breaks ties so the cutoff is deterministic. */
export function selectStaleAuditBodyRequestIds(
  bodies: readonly AuditBodyRecord[],
  audits: readonly AuditRecord[],
  keepLast: number,
): string[] {
  if (!Number.isInteger(keepLast) || keepLast <= 0) return [];
  const keep = new Set(
    [...audits]
      .sort((left, right) => {
        const byTime = right.createdAt.getTime() - left.createdAt.getTime();
        return byTime !== 0 ? byTime : right.id - left.id;
      })
      .slice(0, keepLast)
      .map((row) => row.requestId),
  );
  return bodies.map((body) => body.requestId).filter((requestId) => !keep.has(requestId));
}

/**
 * Drop JSON bodies that are not among the newest `keepLast` request audits.
 * Metadata in `request_audits` is kept. `keepLast <= 0` disables pruning.
 */
export async function pruneStaleAuditBodies(keepLast: number): Promise<number> {
  if (!Number.isInteger(keepLast) || keepLast <= 0) return 0;
  const deleted = await sql`
    WITH keep AS (
      SELECT request_id
      FROM request_audits
      ORDER BY created_at DESC, id DESC
      LIMIT ${keepLast}
    )
    DELETE FROM request_audit_bodies AS body
    WHERE NOT EXISTS (
      SELECT 1 FROM keep WHERE keep.request_id = body.request_id
    )
    RETURNING body.request_id
  `;
  if (deleted.count > 0) {
    try {
      // Reclaim dead tuples for reuse. Does not take an exclusive lock.
      await sql.unsafe("VACUUM request_audit_bodies");
    } catch {
      // Autovacuum still reclaims later; do not fail the prune after DELETE.
    }
  }
  return deleted.count;
}

export function startAuditBodyRetention(options: {
  keepLast: number;
  intervalMs: number;
  prune?: (keepLast: number) => Promise<number>;
  log?: {
    info: (payload: unknown, message: string) => void;
    error: (payload: unknown, message: string) => void;
  };
}): { stop: () => void } {
  const prune = options.prune ?? pruneStaleAuditBodies;
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async () => {
    if (running) return;
    if (!Number.isInteger(options.keepLast) || options.keepLast <= 0) return;
    running = true;
    try {
      const deleted = await prune(options.keepLast);
      if (deleted > 0) {
        options.log?.info({ deleted, keepLast: options.keepLast }, "pruned stale relay audit bodies");
      }
    } catch (error) {
      options.log?.error({ err: error }, "failed to prune stale relay audit bodies");
    } finally {
      running = false;
    }
  };

  void tick();
  if (Number.isInteger(options.intervalMs) && options.intervalMs > 0) {
    timer = setInterval(() => {
      void tick();
    }, options.intervalMs);
    timer.unref?.();
  }

  return {
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
