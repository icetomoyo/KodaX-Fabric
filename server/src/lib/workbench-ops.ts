import { and, eq, gte, lt, sql } from "drizzle-orm";
import { env } from "../config.js";
import { db } from "../db/client.js";
import {
  channelSeats,
  productLines,
  providers,
  sensitiveWordHits,
  tidalApplications,
  tidalGrants,
  upstreamCredentials,
} from "../db/schema/index.js";
import { effectiveCredentialStatus, type CredentialStatus } from "./credential-status.js";
import { snapshotTidalInFlight } from "./relay/credential-load.js";
import {
  credentialWindowAnchors,
  effectiveWeeklyResetAt,
  getCredentialQuotaUsage,
  nextFiveHourResetAt,
  nextWeeklyResetAt,
  packageCreditLimits,
  type CredentialWindowAnchors,
} from "./relay/credential-quota.js";
import { isTidalWindowOpen, loadTidalSettings } from "./relay/tidal-settings.js";
import {
  requestContextStorageReport,
  type RequestContextStorageReport,
} from "./request-context-storage.js";

/** 套餐积分用到这个比例进待办，再高一档升为紧急。 */
export const CREDIT_WARN_RATIO = 0.8;
export const CREDIT_DANGER_RATIO = 0.95;
/** 潮汐授权离到期不足这么多天时提醒续期。 */
export const GRANT_EXPIRY_WARN_DAYS = 3;
/** 与日志存储空间卡片的告警线一致。 */
export const DISK_WARN_RATIO = 0.8;
export const DISK_DANGER_RATIO = 0.9;
export const DISK_DAYS_LEFT_WARN = 14;
/** 上游失败要同时够多、占比够高才提醒，免得零星失败刷屏。 */
export const UPSTREAM_ERROR_MIN_COUNT = 10;
export const UPSTREAM_ERROR_WARN_RATIO = 0.05;

const DAY_MS = 24 * 60 * 60 * 1_000;

export type PoolLineRow = {
  id: number;
  name: string;
  productLineStatus: string;
  providerStatus: string;
  /** 套餐下每把 Key 的积分上限，null 表示不限。 */
  fiveHourLimit: number | null;
  weeklyLimit: number | null;
};

export type PoolKeyRow = {
  id: number;
  productLineId: number;
  status: CredentialStatus;
  coolUntil: Date | null;
  weight: number;
  lastFailureKind: string | null;
  fiveHourCredits: number;
  weeklyCredits: number;
  nextFiveHourResetAt: Date | null;
  nextWeeklyResetAt: Date;
};

export type WindowLoad = {
  used: number;
  capacity: number;
  ratio: number;
  /** 最早有 Key 恢复额度的时刻；5 小时窗口都没开始计时时为 null。 */
  nextResetAt: string | null;
};

export type KeyPoolLine = {
  productLineId: number;
  name: string;
  total: number;
  active: number;
  cooling: number;
  autoDisabled: number;
  disabled: number;
  /** 现在就能被调度的 Key 数：状态可用且权重大于 0。 */
  schedulable: number;
  fiveHour: WindowLoad | null;
  weekly: WindowLoad | null;
};

export type KeyPoolSummary = {
  total: number;
  active: number;
  cooling: number;
  autoDisabled: number;
  disabled: number;
  autoDisabledByKind: { planExpired: number; fairUse: number; auth: number; other: number };
  fiveHour: WindowLoad | null;
  weekly: WindowLoad | null;
  lines: KeyPoolLine[];
};

export type AttentionItem = {
  key: string;
  level: "danger" | "warn";
  title: string;
  detail: string;
  /** 处理这件事的页面；以 # 开头表示就在工作台上的那一块。 */
  to: string;
};

type ServingKey = PoolKeyRow & { effective: CredentialStatus };

function windowLoad(
  serving: ServingKey[],
  limit: number | null,
  capKind: "five_hour_cap" | "weekly_cap",
  creditsOf: (key: ServingKey) => number,
  resetOf: (key: ServingKey) => Date | null,
): WindowLoad | null {
  if (limit == null || !(limit > 0) || serving.length === 0) return null;
  let used = 0;
  let nextReset: Date | null = null;
  for (const key of serving) {
    // 上游已经回了这个窗口用尽，本地账本记得少也按用满算（Key 可能在平台外被用过）。
    const exhausted = key.effective === "cooling" && key.lastFailureKind === capKind;
    used += exhausted ? limit : Math.min(limit, Math.max(0, creditsOf(key)));
    const reset = resetOf(key);
    if (reset && (!nextReset || reset.getTime() < nextReset.getTime())) nextReset = reset;
  }
  const capacity = limit * serving.length;
  return { used, capacity, ratio: used / capacity, nextResetAt: nextReset?.toISOString() ?? null };
}

function mergeLoads(loads: Array<WindowLoad | null>): WindowLoad | null {
  let used = 0;
  let capacity = 0;
  let nextReset: string | null = null;
  for (const load of loads) {
    if (!load) continue;
    used += load.used;
    capacity += load.capacity;
    if (load.nextResetAt && (!nextReset || load.nextResetAt < nextReset)) nextReset = load.nextResetAt;
  }
  if (!(capacity > 0)) return null;
  return { used, capacity, ratio: used / capacity, nextResetAt: nextReset };
}

/**
 * 启用渠道（渠道与所属平台都启用）上的 Key 池现状。停用渠道上的 Key 不参与调度，不计入。
 *
 * 积分用量只看还在服务的 Key（可用或冷却中、权重大于 0）：停用的 Key 提供不了容量，
 * 算进分母会把快用完的池子显示成还有富余。
 */
export function summarizeKeyPool(
  lineRows: PoolLineRow[],
  keyRows: PoolKeyRow[],
  now: Date = new Date(),
): KeyPoolSummary {
  const keysByLine = new Map<number, PoolKeyRow[]>();
  for (const key of keyRows) {
    const list = keysByLine.get(key.productLineId);
    if (list) list.push(key);
    else keysByLine.set(key.productLineId, [key]);
  }

  const summary: KeyPoolSummary = {
    total: 0,
    active: 0,
    cooling: 0,
    autoDisabled: 0,
    disabled: 0,
    autoDisabledByKind: { planExpired: 0, fairUse: 0, auth: 0, other: 0 },
    fiveHour: null,
    weekly: null,
    lines: [],
  };

  for (const line of lineRows) {
    if (line.providerStatus !== "active" || line.productLineStatus !== "active") continue;
    const acc: KeyPoolLine = {
      productLineId: line.id,
      name: line.name,
      total: 0,
      active: 0,
      cooling: 0,
      autoDisabled: 0,
      disabled: 0,
      schedulable: 0,
      fiveHour: null,
      weekly: null,
    };
    const serving: ServingKey[] = [];
    for (const key of keysByLine.get(line.id) ?? []) {
      const effective = effectiveCredentialStatus(key.status, key.coolUntil, now);
      acc.total += 1;
      if (effective === "active") acc.active += 1;
      else if (effective === "cooling") acc.cooling += 1;
      else if (effective === "disabled") acc.disabled += 1;
      else {
        acc.autoDisabled += 1;
        if (key.lastFailureKind === "plan_expired") summary.autoDisabledByKind.planExpired += 1;
        else if (key.lastFailureKind === "fair_use") summary.autoDisabledByKind.fairUse += 1;
        else if (key.lastFailureKind === "auth") summary.autoDisabledByKind.auth += 1;
        else summary.autoDisabledByKind.other += 1;
      }
      if (!(key.weight > 0)) continue;
      if (effective === "active") acc.schedulable += 1;
      if (effective === "active" || effective === "cooling") serving.push({ ...key, effective });
    }
    acc.fiveHour = windowLoad(
      serving,
      line.fiveHourLimit,
      "five_hour_cap",
      (key) => key.fiveHourCredits,
      (key) => key.nextFiveHourResetAt,
    );
    acc.weekly = windowLoad(
      serving,
      line.weeklyLimit,
      "weekly_cap",
      (key) => key.weeklyCredits,
      (key) => key.nextWeeklyResetAt,
    );
    summary.total += acc.total;
    summary.active += acc.active;
    summary.cooling += acc.cooling;
    summary.autoDisabled += acc.autoDisabled;
    summary.disabled += acc.disabled;
    summary.lines.push(acc);
  }

  summary.fiveHour = mergeLoads(summary.lines.map((line) => line.fiveHour));
  summary.weekly = mergeLoads(summary.lines.map((line) => line.weekly));
  return summary;
}

function zonedStamp(iso: string, timeZone: string, withDate: boolean): string {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const clock = `${parts.hour}:${parts.minute}`;
  return withDate ? `${parts.month}-${parts.day} ${clock}` : clock;
}

function percentOf(ratio: number): number {
  return Math.round(ratio * 100);
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.max(0, Math.round(bytes / 1024 ** 2))} MB`;
}

function creditItem(
  line: KeyPoolLine,
  load: WindowLoad | null,
  window: "5h" | "weekly",
  timeZone: string,
): AttentionItem | null {
  if (!load || load.ratio < CREDIT_WARN_RATIO) return null;
  const label = window === "5h" ? "5 小时积分" : "周积分";
  const reset = load.nextResetAt
    ? `，最早 ${zonedStamp(load.nextResetAt, timeZone, window === "weekly")} 重置`
    : "";
  return {
    key: `credit-${window}:${line.productLineId}`,
    level: load.ratio >= CREDIT_DANGER_RATIO ? "danger" : "warn",
    title: `「${line.name}」${label}已用 ${percentOf(load.ratio)}%`,
    detail: `在用的 Key 合计 ${Math.round(load.used)} / ${Math.round(load.capacity)} 积分${reset}`,
    to: `/admin/keys-board?channelId=${line.productLineId}`,
  };
}

export type AttentionInput = {
  keyPool: KeyPoolSummary;
  tidal: { enabled: boolean; pendingApplications: number; grants: { expiringSoon: number } };
  storage: Pick<RequestContextStorageReport, "disk" | "logs">;
  today: { requests: number; upstreamErrors: number };
  timeZone: string;
};

/** 工作台首屏的待办：每条都是现在要有人去处理的事，紧急的排前面。 */
export function buildAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { keyPool } = input;

  if (keyPool.autoDisabled > 0) {
    const kinds = keyPool.autoDisabledByKind;
    const parts = [
      kinds.planExpired > 0 ? `套餐到期 ${kinds.planExpired}` : "",
      kinds.fairUse > 0 ? `风控 ${kinds.fairUse}` : "",
      kinds.auth > 0 ? `鉴权失败 ${kinds.auth}` : "",
      kinds.other > 0 ? `其他 ${kinds.other}` : "",
    ].filter(Boolean);
    const affected = keyPool.lines.filter((line) => line.autoDisabled > 0);
    items.push({
      key: "key-auto-disabled",
      level: "danger",
      title: `${keyPool.autoDisabled} 把渠道 Key 被自动停用`,
      detail: `${parts.join(" · ")}，处理后需要手动启用`,
      to:
        affected.length === 1
          ? `/admin/keys-board?channelId=${affected[0]!.productLineId}`
          : "/admin/keys-board",
    });
  }

  const stuck = keyPool.lines.filter((line) => line.schedulable === 0);
  if (stuck.length > 0) {
    items.push({
      key: "channel-unavailable",
      level: "danger",
      title: `${stuck.length} 条启用渠道没有可调度 Key`,
      detail: stuck.map((line) => line.name).join("、"),
      to: "/admin/temp-channels",
    });
  }

  const credits: Array<{ item: AttentionItem; ratio: number }> = [];
  for (const line of keyPool.lines) {
    const fiveHour = creditItem(line, line.fiveHour, "5h", input.timeZone);
    if (fiveHour) credits.push({ item: fiveHour, ratio: line.fiveHour!.ratio });
    const weekly = creditItem(line, line.weekly, "weekly", input.timeZone);
    if (weekly) credits.push({ item: weekly, ratio: line.weekly!.ratio });
  }
  credits.sort((a, b) => b.ratio - a.ratio);
  items.push(...credits.map((entry) => entry.item));

  const { requests, upstreamErrors } = input.today;
  if (
    upstreamErrors >= UPSTREAM_ERROR_MIN_COUNT &&
    requests > 0 &&
    upstreamErrors / requests >= UPSTREAM_ERROR_WARN_RATIO
  ) {
    items.push({
      key: "upstream-errors",
      level: "warn",
      title: `今日上游失败 ${upstreamErrors} 次`,
      detail: `占今日请求的 ${percentOf(upstreamErrors / requests)}%`,
      to: "/admin/error-logs",
    });
  }

  const { disk, logs } = input.storage;
  const daysLeft = logs?.daysLeft ?? null;
  const diskRatio = disk && disk.totalBytes > 0 ? disk.usedBytes / disk.totalBytes : null;
  if (disk && diskRatio != null && diskRatio >= DISK_WARN_RATIO) {
    items.push({
      key: "disk",
      level: diskRatio >= DISK_DANGER_RATIO ? "danger" : "warn",
      title: `日志磁盘已用 ${percentOf(diskRatio)}%`,
      detail:
        `剩余 ${formatBytes(disk.freeBytes)}` +
        (daysLeft != null ? `，按近 7 天增速约可再用 ${daysLeft} 天` : ""),
      to: "#log-storage",
    });
  } else if (daysLeft != null && daysLeft <= DISK_DAYS_LEFT_WARN) {
    items.push({
      key: "disk",
      level: "warn",
      title: `日志磁盘约 ${daysLeft} 天后写满`,
      detail: `${disk ? `剩余 ${formatBytes(disk.freeBytes)}，` : ""}按近 7 天日均增长估算`,
      to: "#log-storage",
    });
  }

  if (input.tidal.pendingApplications > 0) {
    items.push({
      key: "tidal-applications",
      level: "warn",
      title: `${input.tidal.pendingApplications} 个潮汐申请待审核`,
      detail: "员工申请了潮汐KEY，通过后按申请的到期时间可用",
      to: "/admin/tidal",
    });
  }

  if (input.tidal.enabled && input.tidal.grants.expiringSoon > 0) {
    items.push({
      key: "tidal-grants",
      level: "warn",
      title: `${input.tidal.grants.expiringSoon} 个潮汐授权 ${GRANT_EXPIRY_WARN_DAYS} 天内到期`,
      detail: "到期后对应员工的潮汐 KEY 不能再用，需要的话去续期",
      to: "/admin/tidal",
    });
  }

  return [
    ...items.filter((item) => item.level === "danger"),
    ...items.filter((item) => item.level === "warn"),
  ];
}

async function loadKeyPool(now: Date): Promise<KeyPoolSummary> {
  const [lineRows, keyRows] = await Promise.all([
    db
      .select({
        id: productLines.id,
        name: productLines.name,
        productLineStatus: productLines.status,
        providerStatus: providers.status,
        fiveHourCreditLimit: productLines.fiveHourCreditLimit,
        weeklyCreditLimit: productLines.weeklyCreditLimit,
        lineWeeklyWindowResetAt: productLines.weeklyWindowResetAt,
      })
      .from(productLines)
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .orderBy(productLines.id),
    db
      .select({
        id: upstreamCredentials.id,
        productLineId: upstreamCredentials.productLineId,
        status: upstreamCredentials.status,
        coolUntil: upstreamCredentials.coolUntil,
        weight: upstreamCredentials.weight,
        lastFailureKind: upstreamCredentials.lastFailureKind,
        fiveHourWindowAnchor: upstreamCredentials.fiveHourWindowAnchor,
        fiveHourWindowBaseCredits: upstreamCredentials.fiveHourWindowBaseCredits,
        weeklyWindowResetAt: upstreamCredentials.weeklyWindowResetAt,
      })
      .from(upstreamCredentials),
  ]);

  const lineById = new Map(lineRows.map((line) => [line.id, line]));
  const windowRows = keyRows.map((key) => ({
    ...key,
    lineWeeklyWindowResetAt: lineById.get(key.productLineId)?.lineWeeklyWindowResetAt ?? null,
  }));
  const anchorsById = new Map<number, CredentialWindowAnchors>(
    windowRows.map((key) => [key.id, credentialWindowAnchors(key)]),
  );
  const usageById = await getCredentialQuotaUsage(
    windowRows.map((key) => key.id),
    now,
    anchorsById,
  );

  return summarizeKeyPool(
    lineRows.map((line) => {
      const limits = packageCreditLimits(line);
      return {
        id: line.id,
        name: line.name,
        productLineStatus: line.productLineStatus,
        providerStatus: line.providerStatus,
        fiveHourLimit: limits.fiveHourLimit,
        weeklyLimit: limits.weeklyLimit,
      };
    }),
    windowRows.map((key) => {
      const usage = usageById.get(key.id);
      return {
        id: key.id,
        productLineId: key.productLineId,
        status: key.status,
        coolUntil: key.coolUntil,
        weight: Number(key.weight ?? 0),
        lastFailureKind: key.lastFailureKind,
        fiveHourCredits: usage?.fiveHourCredits ?? 0,
        weeklyCredits: usage?.weeklyCredits ?? 0,
        nextFiveHourResetAt: nextFiveHourResetAt(key.fiveHourWindowAnchor, now),
        nextWeeklyResetAt: nextWeeklyResetAt(effectiveWeeklyResetAt(key), now),
      };
    }),
    now,
  );
}

/** 超管工作台除用量以外的运行现状：Key 池、席位、潮汐、敏感词、日志磁盘。 */
export async function loadWorkbenchOps(
  now: Date,
  today: { start: Date; endExclusive: Date },
) {
  const [keyPool, seatRow, seatCapacityRow, grantRows, pendingRow, hitRows, settings, storage] =
    await Promise.all([
      loadKeyPool(now),
      db
        .select({
          registered: sql<number>`count(*)::int`,
          submitted: sql<number>`count(${channelSeats.credentialId})::int`,
        })
        .from(channelSeats)
        .then((rows) => rows[0]),
      db
        .select({
          capacity: sql<number>`coalesce(sum(greatest(${productLines.seatCount}, 0)), 0)::int`,
        })
        .from(productLines)
        .then((rows) => rows[0]),
      db.select({ expiresAt: tidalGrants.expiresAt }).from(tidalGrants),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tidalApplications)
        .where(eq(tidalApplications.status, "pending"))
        .then((rows) => rows[0]),
      db
        .select({
          action: sensitiveWordHits.action,
          n: sql<number>`count(*)::int`,
        })
        .from(sensitiveWordHits)
        .where(
          and(
            gte(sensitiveWordHits.createdAt, today.start),
            lt(sensitiveWordHits.createdAt, today.endExclusive),
          ),
        )
        .groupBy(sensitiveWordHits.action),
      loadTidalSettings(),
      requestContextStorageReport(now),
    ]);

  const nowMs = now.getTime();
  const soonMs = nowMs + GRANT_EXPIRY_WARN_DAYS * DAY_MS;
  let expired = 0;
  let expiringSoon = 0;
  for (const grant of grantRows) {
    const at = grant.expiresAt?.getTime();
    if (at == null) continue;
    if (at <= nowMs) expired += 1;
    else if (at <= soonMs) expiringSoon += 1;
  }
  let tidalInFlight = 0;
  for (const n of snapshotTidalInFlight().values()) tidalInFlight += n;
  const hits = (action: "detect" | "intercept") =>
    Number(hitRows.find((row) => row.action === action)?.n ?? 0);

  return {
    keyPool,
    seats: {
      registered: Number(seatRow?.registered ?? 0),
      submitted: Number(seatRow?.submitted ?? 0),
      /** 各套餐席位上限之和；没设上限的套餐不计入。 */
      capacity: Number(seatCapacityRow?.capacity ?? 0),
    },
    tidal: {
      enabled: settings.enabled,
      windowOpen: settings.enabled && isTidalWindowOpen(settings, now),
      windowStart: settings.windowStart,
      windowEnd: settings.windowEnd,
      inFlight: tidalInFlight,
      pendingApplications: Number(pendingRow?.n ?? 0),
      grants: { total: grantRows.length, expired, expiringSoon },
    },
    sensitive: { detectToday: hits("detect"), interceptToday: hits("intercept") },
    storage,
    timeZone: env.QUOTA_TIMEZONE,
  };
}
